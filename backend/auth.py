import os
from datetime import datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

ALGO = "HS256"
EXPIRE_DAYS = 7
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_ctx.verify(password, password_hash)
    except (UnknownHashError, ValueError, TypeError):
        return False


def make_token(user_id: int) -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET is missing. Set it before starting the server (for example: $env:JWT_SECRET = 'your-long-random-secret').")
    payload = {"sub": str(user_id), "exp": datetime.utcnow() + timedelta(days=EXPIRE_DAYS)}
    return jwt.encode(payload, secret, algorithm=ALGO)


def read_token(token: str):
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        return None
    try:
        return int(jwt.decode(token, secret, algorithms=[ALGO])["sub"])
    except (JWTError, KeyError, ValueError):
        return None
