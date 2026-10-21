from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String(24), unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, default="", nullable=False)
    email_verified = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class LadderProgress(Base):
    __tablename__ = "ladder_progress"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    current_length = Column(Integer, default=5, nullable=False)
    answer = Column(String(20), nullable=False)
    guesses_used = Column(Integer, default=0, nullable=False)
    guesses_json = Column(String, default="[]", nullable=False)
    best_length = Column(Integer, default=0, nullable=False)
    run_best_length = Column(Integer, default=0, nullable=False)
    run_number = Column(Integer, default=1, nullable=False)
    last_answers = Column(String, default="{}", nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class NormalGame(Base):
    __tablename__ = "normal_games"

    id = Column(Integer, primary_key=True)
    game_code = Column(String(32), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    answer = Column(String(20), nullable=False)
    length = Column(Integer, nullable=False)
    max_guesses = Column(Integer, nullable=False)
    guesses_json = Column(String, default="[]", nullable=False)
    status = Column(String(16), default="playing", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DailyWord(Base):
    __tablename__ = "daily_words"

    word_date = Column(Date, primary_key=True)
    word = Column(String(5), nullable=False)


class DailyResult(Base):
    __tablename__ = "daily_results"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_date = Column(Date, nullable=False)
    won = Column(Boolean, nullable=False)
    guesses_used = Column(Integer, nullable=False)
    finished_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "word_date"),)


class CustomGame(Base):
    __tablename__ = "custom_games"

    id = Column(Integer, primary_key=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    answer = Column(String(10), nullable=False)
    length = Column(Integer, nullable=False)
    share_code = Column(String(12), unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CustomAttempt(Base):
    __tablename__ = "custom_attempts"

    id = Column(Integer, primary_key=True)
    game_id = Column(Integer, ForeignKey("custom_games.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    won = Column(Boolean, nullable=False)
    guesses_used = Column(Integer, nullable=False)
    finished_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (UniqueConstraint("game_id", "player_id"),)
