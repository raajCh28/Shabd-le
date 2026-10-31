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
