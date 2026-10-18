from datetime import date
from pathlib import Path

from dictionary import DICTIONARY_WORDS

WORD_FILE = Path(__file__).with_name("words.txt")
WORDS = [line.strip().lower() for line in WORD_FILE.read_text(encoding="utf-8").splitlines()
         if len(line.strip()) == 5 and line.strip().isalpha()]
VALID_GUESSES = DICTIONARY_WORDS
EPOCH = date(2024, 1, 1)


def pick_daily_word(day: date) -> str:
    if not WORDS:
        raise RuntimeError("The daily word list is empty")
    return WORDS[(day - EPOCH).days % len(WORDS)]


def score_guess(guess: str, answer: str) -> list[str]:
    """Score any equal-length words with duplicate-aware two-pass Wordle rules."""
    if len(guess) != len(answer):
        raise ValueError("Guess and answer must have the same length")
    result = ["absent"] * len(answer)
    remaining = {}
    for index, (letter, target) in enumerate(zip(guess, answer)):
        if letter == target:
            result[index] = "correct"
        else:
            remaining[target] = remaining.get(target, 0) + 1
    for index, letter in enumerate(guess):
        if result[index] == "correct":
            continue
        if remaining.get(letter, 0):
            result[index] = "present"
            remaining[letter] -= 1
    return result


def verify_finished_guesses(guesses: list[str], answer: str) -> tuple[bool, int]:
    """Verify the submitted game history really ends at its claimed win or loss."""
    if not 1 <= len(guesses) <= 6:
        return False, len(guesses)
    for index, guess in enumerate(guesses):
        if len(guess) != len(answer) or not guess.isalpha():
            return False, len(guesses)
        won = all(tile == "correct" for tile in score_guess(guess, answer))
        if won and index != len(guesses) - 1:
            return False, len(guesses)
        if index < len(guesses) - 1 and won:
            return False, len(guesses)
    last_won = guesses[-1] == answer
    return (last_won or len(guesses) == 6), len(guesses)
