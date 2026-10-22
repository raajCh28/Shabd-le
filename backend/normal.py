import json
import secrets
from collections import Counter

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
    max_guesses: int = Field(ge=2, le=8)
    hard_mode: bool = False


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
        "hard_mode": game.hard_mode,
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
        hard_mode=settings.hard_mode,
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

    if game.hard_mode:
        enforce_hard_mode(guess, history)

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


def enforce_hard_mode(guess: str, history: list[dict]) -> None:
    required_counts: Counter[str] = Counter()
    green_positions: dict[int, str] = {}
    yellow_positions: dict[str, set[int]] = {}

    for entry in history:
        guess_counts: Counter[str] = Counter()
        for position, (letter, result) in enumerate(zip(entry["guess"], entry["result"])):
            if result == "correct":
                green_positions[position] = letter
                guess_counts[letter] += 1
            elif result == "present":
                yellow_positions.setdefault(letter, set()).add(position)
                guess_counts[letter] += 1
        for letter, count in guess_counts.items():
            required_counts[letter] = max(required_counts[letter], count)

    for position, letter in green_positions.items():
        if guess[position] != letter:
            raise HTTPException(422, f"Hard Mode: keep {letter} in position {position + 1}.")

    for letter, positions in yellow_positions.items():
        if guess.count(letter) < required_counts[letter]:
            raise HTTPException(422, f"Hard Mode: use the yellow letter {letter}.")
        for position in positions:
            if guess[position] == letter and green_positions.get(position) != letter:
                raise HTTPException(422, f"Hard Mode: move yellow {letter} to a different position.")


def normal_stats(user: User, db: Session) -> dict:
    games = (
        db.query(NormalGame)
        .filter(NormalGame.user_id == user.id, NormalGame.status.in_(("won", "lost")))
        .order_by(NormalGame.id.asc())
        .all()
    )
    wins = [game for game in games if game.status == "won"]
    won_attempts = [len(json.loads(game.guesses_json or "[]")) for game in wins]
    total = len(games)
    distribution = [0] * 8
    recent_games = list(reversed(games[-5:]))
    history = []
    for game in games:
        guesses_used = len(json.loads(game.guesses_json or "[]"))
        if game.status == "won" and 1 <= guesses_used <= len(distribution):
            distribution[guesses_used - 1] += 1
    for game in recent_games:
        history.append({
            "date": game.created_at.date().isoformat(),
            "won": game.status == "won",
            "guesses": len(json.loads(game.guesses_json or "[]")),
            "length": game.length,
            "hard_mode": game.hard_mode,
        })

    streak = 0
    best_streak = 0
    for game in games:
        if game.status == "won":
            streak += 1
            best_streak = max(best_streak, streak)
        else:
            streak = 0
    return {
        "games_played": total,
        "wins": len(wins),
        "win_rate": round((len(wins) / total) * 100) if total else 0,
        "current_streak": streak,
        "best_streak": best_streak,
        "average_guesses": round(sum(won_attempts) / len(won_attempts), 1) if won_attempts else None,
        "guess_distribution": distribution,
        "history": history,
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

    @router.get("/stats")
    def normal_stats_route(
        user: User = Depends(current_user_dependency),
        db: Session = Depends(db_dependency),
    ):
        return normal_stats(user, db)

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
