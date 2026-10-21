from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import hash_password, make_token, verify_password
from models import User


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    class Config:
        str_strip_whitespace = True


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    password: str


def user_response(user: User) -> dict:
    return {
        "token": make_token(user.id),
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
        },
    }


def make_router(get_db, current_user, limiter):
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    @router.post("/register")
    def register(data: RegisterIn, db: Session = Depends(get_db)):
        email = str(data.email).lower()
        username = data.username.strip().lower()
        if db.query(User).filter_by(username=username).first():
            raise HTTPException(400, "Username already taken")
        if db.query(User).filter_by(email=email).first():
            raise HTTPException(400, "Email already registered")

        user = User(
            email=email,
            username=username,
            display_name=username,
            password_hash=hash_password(data.password),
            email_verified=True,
        )
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            raise HTTPException(400, "Email or username already registered")
        return user_response(user)

    @router.post("/login")
    @limiter.limit("10/minute")
    def login(request: Request, data: LoginIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(username=data.username.strip().lower()).first()
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(401, "Wrong username or password")
        return user_response(user)

    @router.get("/me")
    def me(user: User = Depends(current_user)):
        return {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
        }

    return router
