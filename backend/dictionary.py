"""Broad accepted-guess vocabulary; puzzle answers remain separately curated."""

from pathlib import Path

DICTIONARY_FILE = Path(__file__).with_name("dictionary_words.txt")
MIN_WORD_LENGTH = 3
MAX_WORD_LENGTH = 20


def load_dictionary() -> frozenset[str]:
    if not DICTIONARY_FILE.is_file():
        raise RuntimeError(f"English guess dictionary is missing: {DICTIONARY_FILE}")

    words = {
        line.strip().lower()
        for line in DICTIONARY_FILE.read_text(encoding="utf-8").splitlines()
        if MIN_WORD_LENGTH <= len(line.strip()) <= MAX_WORD_LENGTH
        and line.strip().isascii()
        and line.strip().isalpha()
    }
    if not words:
        raise RuntimeError("English guess dictionary is empty")
    return frozenset(words)


DICTIONARY_WORDS = load_dictionary()
