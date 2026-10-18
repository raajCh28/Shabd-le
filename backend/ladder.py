import json
import secrets
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from game import score_guess
from models import LadderProgress, User

WORDS_BY_LENGTH: dict[int, list[str]] = {}
word_file = Path(__file__).with_name("ladder_words.txt")
for raw_word in word_file.read_text(encoding="utf-8").splitlines():
    word = raw_word.strip().lower()
    if word.isascii() and word.isalpha() and 5 <= len(word) <= 20:
        WORDS_BY_LENGTH.setdefault(len(word), []).append(word)


class LadderGuess(BaseModel):
    guess: str
    guesses: list[str] = Field(default_factory=list)


def choose_word(length: int, previous_by_length: dict[str, str]) -> str:
    candidates = WORDS_BY_LENGTH.get(length, [])
    if not candidates:
        raise HTTPException(500, f"Ladder has no word for length {length}")
    previous = previous_by_length.get(str(length))
    fresh = [word for word in candidates if word != previous]
    return secrets.choice(fresh or candidates)


def get_or_create_progress(db: Session, user_id: int) -> LadderProgress:
    progress = db.get(LadderProgress, user_id)
    if progress:
        return progress
    history: dict[str, str] = {}
    progress = LadderProgress(
        user_id=user_id,
        current_length=5,
        answer=choose_word(5, history),
        last_answers=json.dumps(history),
    )
    db.add(progress)
    db.commit()
    return progress


def validate_guess(raw: str, length: int) -> str:
    guess = raw.strip().upper()
    if len(guess) != length or not guess.isascii() or not guess.isalpha():
        raise HTTPException(422, f"Guess must be {length} letters")
    return guess


def validate_prior(guesses: list[str], answer: str, expected_count: int) -> list[str]:
    if len(guesses) != expected_count or len(guesses) > 5:
        raise HTTPException(409, "This Ladder step changed. Reload to continue with the current word.")
    cleaned = [validate_guess(word, len(answer)) for word in guesses]
    if any(all(tile == "correct" for tile in score_guess(word, answer)) for word in cleaned):
        raise HTTPException(409, "This Ladder step is already complete. Reload to continue.")
    return cleaned


def get_state(user: User, db: Session) -> dict:
    progress = get_or_create_progress(db, user.id)
    history = json.loads(progress.guesses_json or "[]")
    if progress.guesses_used != len(history):
        progress.guesses_used = len(history)
        db.commit()
    return {
        "length": progress.current_length,
        "max_guesses": 6,
        "best_length": progress.best_length,
        "run_best_length": progress.run_best_length,
        "climbed_to": progress.run_best_length or progress.best_length,
        "run_number": progress.run_number,
        "guesses_used": len(history),
        "guesses": history,
    }


def submit_guess(user: User, data: LadderGuess, db: Session) -> dict:
    progress = get_or_create_progress(db, user.id)
    answer = progress.answer.upper()
    history = json.loads(progress.guesses_json or "[]")
    stored_guesses = [entry["guess"] for entry in history]
    if data.guesses != stored_guesses:
        raise HTTPException(409, "This Ladder step changed. Reload to continue with the current word.")
    prior = validate_prior(data.guesses, answer, progress.guesses_used)
    guess = validate_guess(data.guess, progress.current_length)
    result = score_guess(guess, answer)
    won = all(tile == "correct" for tile in result)
    used = len(prior) + 1
    ended = won or used >= 6
    response = {"result": result, "status": "playing", "guesses_used": used}
    history.append({"guess": guess, "result": result})
    progress.guesses_used = used
    progress.guesses_json = json.dumps(history)

    if ended:
        last_answers = json.loads(progress.last_answers or "{}")
        last_answers[str(progress.current_length)] = progress.answer
        progress.last_answers = json.dumps(last_answers)
        response["answer"] = answer
        if won:
            progress.run_best_length = max(progress.run_best_length, progress.current_length)
            progress.best_length = max(progress.best_length, progress.current_length)
            if progress.current_length == 20:
                response.update(status="complete", climbed_to=20)
                progress.current_length = 5
                progress.run_best_length = 0
                progress.run_number += 1
                progress.answer = choose_word(5, last_answers)
                progress.guesses_json = "[]"
            else:
                response["status"] = "won"
                progress.current_length += 1
                progress.answer = choose_word(progress.current_length, last_answers)
            response["next_length"] = progress.current_length
            progress.guesses_used = 0
            progress.guesses_json = "[]"
        else:
            response.update(status="lost", climbed_to=progress.run_best_length)
            progress.current_length = 5
            progress.run_best_length = 0
            progress.run_number += 1
            progress.answer = choose_word(5, last_answers)
            progress.guesses_used = 0
            progress.guesses_json = "[]"
        progress.updated_at = datetime.utcnow()

    db.commit()
    return response


def make_router(current_user_dependency, db_dependency, limiter):
    router = APIRouter(prefix="/api/ladder", tags=["ladder"])
    @router.get("/state")
    def ladder_state(user: User = Depends(current_user_dependency), db: Session = Depends(db_dependency)):
        return get_state(user, db)

    @router.post("/guess")
    @limiter.limit("60/minute")
    def ladder_guess(
        request: Request,
        data: LadderGuess,
        user: User = Depends(current_user_dependency),
        db: Session = Depends(db_dependency),
    ):
        return submit_guess(user, data, db)

    return router
