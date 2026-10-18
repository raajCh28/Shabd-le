import smtplib
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import hash_password, make_token, verify_password
from email_verification import (
    MAX_CODE_ATTEMPTS,
    email_delivery_configured,
    new_verification_code,
    revoke_user_verifications,
    send_verification_email,
    verification_code_matches,
)
from models import EmailVerification, User

class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    class Config:
        str_strip_whitespace = True


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    password: str


class VerifyEmailIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class EmailIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128)


def issue_verification(db: Session, user: User, purpose: str = "email_verification"):
    revoke_user_verifications(db, user.id, purpose)
    code, token_hash, expires_at = new_verification_code(user.id, purpose)
    db.add(EmailVerification(user_id=user.id, token_hash=token_hash, purpose=purpose, expires_at=expires_at))
    try:
        send_verification_email(user, code, purpose)
    except (OSError, smtplib.SMTPException, RuntimeError, ValueError) as error:
        db.rollback()
        logging.exception("OTP email delivery failed (%s)", type(error).__name__)
        raise HTTPException(503, "Could not send the verification code. Check your email provider settings and try again.") from error
    db.commit()


def make_router(get_db, current_user, limiter):
    router = APIRouter(prefix="/api/auth", tags=["auth"])
    @router.post("/register")
    def register(data: RegisterIn, db: Session = Depends(get_db)):
        if not email_delivery_configured():
            raise HTTPException(503, "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM, or SMTP settings.")
        email = str(data.email).lower()
        username = data.username.lower()
        if db.query(User).filter_by(username=username).first():
            raise HTTPException(400, "Username already taken")
        if db.query(User).filter_by(email=email).first():
            raise HTTPException(400, "Email already registered")
        user = User(email=email, username=username, display_name=username, password_hash=hash_password(data.password))
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(400, "Email or username already registered")
        issue_verification(db, user)
        return {"message": "Account created. Check your email for a six-digit verification code."}

    @router.post("/verify-email")
    @limiter.limit("10/hour")
    def verify_email(request: Request, data: VerifyEmailIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(email=str(data.email).lower()).first()
        verification = (db.query(EmailVerification).filter_by(user_id=user.id, purpose="email_verification").first()
                        if user else None)
        if not verification or verification.expires_at < datetime.utcnow():
            if verification:
                db.delete(verification)
                db.commit()
            raise HTTPException(400, "Code is invalid or expired. Request a new code.")
        if verification.attempts >= MAX_CODE_ATTEMPTS:
            db.delete(verification)
            db.commit()
            raise HTTPException(429, "Too many incorrect codes. Request a new code.")
        if not verification_code_matches(user.id, data.code, verification.token_hash, "email_verification"):
            verification.attempts += 1
            db.commit()
            if verification.attempts >= MAX_CODE_ATTEMPTS:
                db.delete(verification)
                db.commit()
                raise HTTPException(429, "Too many incorrect codes. Request a new code.")
            raise HTTPException(400, "Incorrect verification code")
        user.email_verified = True
        db.delete(verification)
        db.commit()
        return {"message": "Email verified. You can now log in."}

    @router.post("/resend-verification")
    @limiter.limit("3/hour")
    def resend_verification(request: Request, data: EmailIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(email=str(data.email).lower()).first()
        response = {"message": "If the account needs verification, a new email has been sent."}
        if user and not user.email_verified:
            if not email_delivery_configured():
                raise HTTPException(503, "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM, or SMTP settings.")
            issue_verification(db, user)
        return response

    @router.post("/forgot-password")
    @limiter.limit("3/hour")
    def forgot_password(request: Request, data: EmailIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(email=str(data.email).lower()).first()
        if user:
            if not email_delivery_configured():
                raise HTTPException(503, "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM, or SMTP settings.")
            issue_verification(db, user, "password_reset")
        return {"message": "If a verified account uses that email, a password reset code has been sent."}

    @router.post("/reset-password")
    @limiter.limit("10/hour")
    def reset_password(request: Request, data: ResetPasswordIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(email=str(data.email).lower()).first()
        verification = (db.query(EmailVerification).filter_by(user_id=user.id, purpose="password_reset").first()
                        if user else None)
        if not user or not verification or verification.expires_at < datetime.utcnow():
            if verification:
                db.delete(verification)
                db.commit()
            raise HTTPException(400, "Code is invalid or expired. Request a new code.")
        if verification.attempts >= MAX_CODE_ATTEMPTS:
            db.delete(verification)
            db.commit()
            raise HTTPException(429, "Too many incorrect codes. Request a new code.")
        if not verification_code_matches(user.id, data.code, verification.token_hash, "password_reset"):
            verification.attempts += 1
            db.commit()
            if verification.attempts >= MAX_CODE_ATTEMPTS:
                db.delete(verification)
                db.commit()
                raise HTTPException(429, "Too many incorrect codes. Request a new code.")
            raise HTTPException(400, "Incorrect verification code")
        user.password_hash = hash_password(data.new_password)
        # Possession of the reset code proves access to the registration email too.
        user.email_verified = True
        db.delete(verification)
        db.commit()
        return {"message": "Password changed. You can now log in with your new password."}

    @router.post("/login")
    @limiter.limit("10/minute")
    def login(request: Request, data: LoginIn, db: Session = Depends(get_db)):
        user = db.query(User).filter_by(username=data.username.strip().lower()).first()
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(401, "Wrong username or password")
        if not user.email_verified:
            raise HTTPException(403, "Verify your email before logging in")
        return {"token": make_token(user.id), "user": {"id": user.id, "username": user.username,
                "email": user.email, "display_name": user.display_name}}

    @router.get("/me")
    def me(user: User = Depends(current_user)):
        return {"id": user.id, "username": user.username, "email": user.email, "display_name": user.display_name}

    return router
