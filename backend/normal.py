import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from game import VALID_GUESSES, score_guess
from models import NormalGame, User

WORDS_BY_LENGTH: dict[int, list[str]] = {}
for word in VALID_GUESSES:
    WORDS_BY_LENGTH.setdefault(len(word), []).append(word)


class NormalSettings(BaseModel):
    length: int = Field(ge=3, le=20)
    max_guesses: int = Field(ge=1, le=12)


class NormalGuess(BaseModel):
    guess: str
    guesses: list[str] = Field(default_factory=list)


def get_game(db: Session, user_id: int, game_code: str) -> NormalGame:
    game = db.query(NormalGame).filter_by(game_code=game_code, user_id=user_id).first()
    if not game:
        raise HTTPException(404, "Normal Mode game not found. Start a new game.")
    return game


def game_state(game: NormalGame) -> dict:
    return {
        "game_code": game.game_code,
        "length": game.length,
        "max_guesses": game.max_guesses,
        "status": game.status,
        "guesses": json.loads(game.guesses_json or "[]"),
        **({"answer": game.answer.upper()} if game.status != "playing" else {}),
    }


def start_game(user: User, settings: NormalSettings, db: Session) -> dict:
    candidates = WORDS_BY_LENGTH.get(settings.length, [])
    if not candidates:
        raise HTTPException(422, f"No dictionary words are available with {settings.length} letters")

    # Keep completed rounds as history; the newest game code selects the active round.
    game = NormalGame(
        game_code=secrets.token_urlsafe(24),
        user_id=user.id,
        answer=secrets.choice(candidates),
        length=settings.length,
        max_guesses=settings.max_guesses,
        guesses_json="[]",
        status="playing",
    )
    db.add(game)
    db.commit()
    return game_state(game)


def submit_guess(user: User, game_code: str, data: NormalGuess, db: Session) -> dict:
    game = get_game(db, user.id, game_code)
    history = json.loads(game.guesses_json or "[]")
    stored_guesses = [entry["guess"] for entry in history]
    if game.status != "playing":
        raise HTTPException(409, "This game is already complete. Start another round.")
    if data.guesses != stored_guesses:
        raise HTTPException(409, "This game changed. Reload to continue with the current word.")
    if len(stored_guesses) >= game.max_guesses:
        raise HTTPException(409, "No guesses remain. Start another round.")

    guess = data.guess.strip().upper()
    if len(guess) != game.length or not guess.isascii() or not guess.isalpha():
        raise HTTPException(422, f"Guess must be {game.length} letters")
    if guess.lower() not in VALID_GUESSES:
        raise HTTPException(422, "Not in the English dictionary")

    result = score_guess(guess, game.answer.upper())
    won = all(tile == "correct" for tile in result)
    history.append({"guess": guess, "result": result})
    game.guesses_json = json.dumps(history)
    if won:
        game.status = "won"
    elif len(history) >= game.max_guesses:
        game.status = "lost"
    db.commit()

    return {
        "result": result,
        "status": game.status,
        "guesses_used": len(history),
        **({"answer": game.answer.upper()} if game.status != "playing" else {}),
    }


def make_router(current_user_dependency, db_dependency, limiter):
    router = APIRouter(prefix="/api/normal", tags=["normal mode"])

    @router.post("/start")
    @limiter.limit("30/minute")
    def normal_start(
        request: Request,
        settings: NormalSettings,
        user: User = Depends(current_user_dependency),
        db: Session = Depends(db_dependency),
    ):
        return start_game(user, settings, db)

    @router.get("/{game_code}")
    def normal_state(
        game_code: str,
        user: User = Depends(current_user_dependency),
        db: Session = Depends(db_dependency),
    ):
        return game_state(get_game(db, user.id, game_code))

    @router.post("/{game_code}/guess")
    @limiter.limit("60/minute")
    def normal_guess(
        request: Request,
        game_code: str,
        data: NormalGuess,
        user: User = Depends(current_user_dependency),
        db: Session = Depends(db_dependency),
    ):
        return submit_guess(user, game_code, data, db)

    return router
