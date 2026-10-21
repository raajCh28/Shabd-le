import os
import secrets
import string
import re
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from auth import read_token
from game import VALID_GUESSES, pick_daily_word, score_guess, verify_finished_guesses
from models import Base, CustomAttempt, CustomGame, DailyResult, DailyWord, LadderProgress, User
from auth_routes import make_router as make_auth_router
from ladder import make_router as make_ladder_router
from normal import make_router as make_normal_router

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./wordle.db")
# Use psycopg 3 for hosted PostgreSQL URLs such as Neon’s default URL.
if DATABASE_URL.startswith(("postgres://", "postgresql://")):
    scheme, remainder = DATABASE_URL.split("://", 1)
    driver_scheme = "postgresql" if scheme == "postgres" else scheme
    DATABASE_URL = f"{driver_scheme}+psycopg://{remainder}"
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base.metadata.create_all(bind=engine)
LadderProgress.__table__.create(bind=engine, checkfirst=True)

def migrate_schema():
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        if "email_verified" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 1"))
        username_was_missing = "username" not in user_columns
        if username_was_missing:
            connection.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(24)"))
        ladder_columns = {column["name"] for column in inspect(engine).get_columns("ladder_progress")}
        if "guesses_json" not in ladder_columns:
            connection.execute(text("ALTER TABLE ladder_progress ADD COLUMN guesses_json VARCHAR NOT NULL DEFAULT '[]'"))
            connection.execute(text("UPDATE ladder_progress SET guesses_used = 0"))
        rows = connection.execute(text("SELECT id, email, username FROM users ORDER BY id")).all()
        claimed = {username.lower() for _, _, username in rows if username}
        for user_id, email, username in rows:
            if username:
                continue
            root = re.sub(r"[^a-z0-9_]", "_", email.split("@", 1)[0].lower()).strip("_")[:18]
            if len(root) < 3:
                root = "player"
            candidate = root
            suffix = 1
            if not username_was_missing and claimed:
                candidate = f"{root[:18]}_{user_id}"[:24]
            while candidate in claimed:
                tail = str(suffix)
                candidate = root[:24 - len(tail)] + tail
                suffix += 1
            connection.execute(text("UPDATE users SET username = :username WHERE id = :id"), {"username": candidate, "id": user_id})
            claimed.add(candidate)
        if username_was_missing:
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"))


migrate_schema()
Base.metadata.tables["users"].c.username.nullable = False

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Wordle", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
bearer = HTTPBearer(auto_error=False)
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}


@app.on_event("startup")
def require_jwt_secret():
    if not os.environ.get("JWT_SECRET"):
        raise RuntimeError("JWT_SECRET is required. Set a long random JWT_SECRET before starting the server.")


class CustomIn(BaseModel):
    word: str


class GuessIn(BaseModel):
    guess: str
    guesses: list[str] = Field(default_factory=list)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    user_id = read_token(cred.credentials) if cred else None
    user = db.get(User, user_id) if user_id else None
    if not user:
        raise HTTPException(401, "Login required")
    return user


app.include_router(make_auth_router(get_db, current_user, limiter))


def get_or_create_daily(db: Session, day: date) -> str:
    row = db.get(DailyWord, day)
    if row:
        return row.word
    row = DailyWord(word_date=day, word=pick_daily_word(day))
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return db.get(DailyWord, day).word
    return row.word


def normalize_guess(raw: str, length: int) -> str:
    guess = raw.strip().upper()
    if len(guess) != length or not guess.isascii() or not guess.isalpha():
        raise HTTPException(422, f"Guess must be {length} letters")
    return guess


def validate_prior(guesses: list[str], answer: str, allowed: bool):
    if len(guesses) > 5:
        raise HTTPException(422, "Too many prior guesses")
    cleaned = []
    for item in guesses:
        guess = normalize_guess(item, len(answer))
        if allowed and guess.lower() not in VALID_GUESSES:
            raise HTTPException(422, "Not in the English dictionary")
        cleaned.append(guess)
    if any(all(tile == "correct" for tile in score_guess(g, answer)) for g in cleaned):
        raise HTTPException(409, "Game already finished")
    return cleaned


def response_for_guess(guess: str, prior: list[str], answer: str, record, db: Session):
    result = score_guess(guess, answer)
    won = all(tile == "correct" for tile in result)
    used = len(prior) + 1
    over = won or used >= 6
    if over:
        record(won, used, [*prior, guess], db)
    status = "won" if won else "lost" if over else "playing"
    return {"result": result, "status": status, "guesses_used": used,
            **({"answer": answer} if over else {})}


@app.get("/api/daily/today")
def daily_today(user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = date.today()
    get_or_create_daily(db, today)
    played = db.query(DailyResult).filter_by(user_id=user.id, word_date=today).first()
    return {"date": str(today), "length": 5, "max_guesses": 6,
            "already_played": played is not None, "won": played.won if played else None}


@app.post("/api/daily/guess")
@limiter.limit("60/minute")
def daily_guess(request: Request, data: GuessIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = date.today()
    row = db.query(DailyResult).filter_by(user_id=user.id, word_date=today).first()
    if row:
        raise HTTPException(409, "Already played today")
    answer = get_or_create_daily(db, today).upper()
    prior = validate_prior(data.guesses, answer, allowed=True)
    guess = normalize_guess(data.guess, 5)
    if guess.lower() not in VALID_GUESSES:
        raise HTTPException(422, "Not in the English dictionary")

    def save(won, used, all_guesses, session):
        valid, verified_used = verify_finished_guesses(all_guesses, answer)
        if not valid or verified_used != used:
            raise HTTPException(400, "Could not verify finished game")
        session.add(DailyResult(user_id=user.id, word_date=today, won=won, guesses_used=used))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Already played today")

    return response_for_guess(guess, prior, answer, save, db)


def find_custom(db: Session, code: str):
    game = db.query(CustomGame).filter_by(share_code=code.lower()).first()
    if not game:
        raise HTTPException(404, "Game not found")
    return game


@app.post("/api/custom")
def create_custom(data: CustomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    word = data.word.strip().upper()
    if not 3 <= len(word) <= 10 or not word.isascii() or not word.isalpha():
        raise HTTPException(422, "Word must be 3-10 letters (A-Z only)")
    alphabet = string.ascii_lowercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not db.query(CustomGame).filter_by(share_code=code).first():
            break
    game = CustomGame(creator_id=user.id, answer=word, length=len(word), share_code=code)
    db.add(game)
    db.commit()
    return {"share_code": code, "url": "/play/" + code, "length": game.length}


@app.get("/api/custom/mine")
def my_custom(user: User = Depends(current_user), db: Session = Depends(get_db)):
    games = db.query(CustomGame).filter_by(creator_id=user.id).order_by(CustomGame.created_at.desc()).all()
    created = []
    for game in games:
        attempts = db.query(CustomAttempt).filter_by(game_id=game.id).all()
        created.append({"share_code": game.share_code, "length": game.length,
                        "created_at": game.created_at.isoformat(), "word": game.answer,
                        "players": len(attempts), "solvers": sum(attempt.won for attempt in attempts)})
    played = []
    attempts = db.query(CustomAttempt).filter_by(player_id=user.id).order_by(CustomAttempt.finished_at.desc()).all()
    for attempt in attempts:
        game = db.get(CustomGame, attempt.game_id)
        if game and game.creator_id != user.id:
            played.append({"share_code": game.share_code, "length": game.length,
                           "won": attempt.won, "guesses_used": attempt.guesses_used})
    return {"created": created, "played": played}


@app.get("/api/custom/{code}")
def open_custom(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    game = find_custom(db, code)
    attempt = db.query(CustomAttempt).filter_by(game_id=game.id, player_id=user.id).first()
    return {"length": game.length, "max_guesses": 6, "creator": game.creator_id == user.id,
            "already_played": attempt is not None, "won": attempt.won if attempt else None}


@app.get("/api/custom/{code}/result")
def custom_result(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    game = find_custom(db, code)
    if game.creator_id != user.id:
        raise HTTPException(403, "Only the creator can view solver results")
    attempts = db.query(CustomAttempt).filter_by(game_id=game.id).all()
    solvers = []
    for attempt in attempts:
        player = db.get(User, attempt.player_id)
        solvers.append({"display_name": player.display_name or player.email.split("@")[0],
                        "won": attempt.won, "guesses_used": attempt.guesses_used,
                        "finished_at": attempt.finished_at.isoformat()})
    return {"share_code": game.share_code, "players": len(attempts),
            "solvers": sum(attempt.won for attempt in attempts), "results": solvers}


@app.post("/api/custom/{code}/guess")
@limiter.limit("60/minute")
def custom_guess(request: Request, code: str, data: GuessIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    game = find_custom(db, code)
    if db.query(CustomAttempt).filter_by(game_id=game.id, player_id=user.id).first():
        raise HTTPException(409, "Already played this game")
    answer = game.answer.upper()
    # Previously entered guesses are accepted as history for games already in progress.
    prior = validate_prior(data.guesses, answer, allowed=False)
    guess = normalize_guess(data.guess, game.length)

    def save(won, used, all_guesses, session):
        valid, verified_used = verify_finished_guesses(all_guesses, answer)
        if not valid or verified_used != used:
            raise HTTPException(400, "Could not verify finished game")
        session.add(CustomAttempt(game_id=game.id, player_id=user.id, won=won, guesses_used=used))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(409, "Already played this game")

    return response_for_guess(guess, prior, answer, save, db)


@app.get("/api/stats/me")
def my_stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(DailyResult).filter_by(user_id=user.id).order_by(DailyResult.word_date).all()
    played = len(rows)
    wins = sum(row.won for row in rows)
    distribution = [0] * 6
    for row in rows:
        if row.won and 1 <= row.guesses_used <= 6:
            distribution[row.guesses_used - 1] += 1
    current = best = run = 0
    previous = None
    for row in rows:
        if row.won and (previous is None or (row.word_date - previous).days == 1):
            run += 1
        elif row.won:
            run = 1
        else:
            run = 0
        previous = row.word_date
        best = max(best, run)
    if rows and rows[-1].won and (date.today() - rows[-1].word_date).days <= 1:
        current = run
    return {"played": played, "wins": wins, "solved_label": f"{wins}/{played}",
            "win_pct": round(100 * wins / played) if played else 0,
            "current_streak": current, "max_streak": best, "guess_distribution": distribution,
            "history": [{"date": str(row.word_date), "won": row.won, "guesses": row.guesses_used}
                        for row in reversed(rows)]}


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store, max-age=0"})


@app.get("/{page}.html", include_in_schema=False)
def page_file(page: str):
    allowed = {"login", "register", "daily", "normal", "create", "dashboard", "game", "ladder"}
    if page not in allowed:
        raise HTTPException(404, "Page not found")
    return FileResponse(
        FRONTEND / f"{page}.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/play/{code}", include_in_schema=False)
def play_page(code: str):
    return FileResponse(FRONTEND / "game.html", headers={"Cache-Control": "no-store, max-age=0"})


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
app.include_router(make_ladder_router(current_user, get_db, limiter))
app.include_router(make_normal_router(current_user, get_db, limiter))
