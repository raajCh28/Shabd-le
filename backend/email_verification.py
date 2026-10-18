import hashlib
import hmac
import os
import secrets
import json
import smtplib
import ssl
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from email.message import EmailMessage

from models import EmailVerification, User

CODE_LIFETIME = timedelta(minutes=10)
MAX_CODE_ATTEMPTS = 5


def email_delivery_configured() -> bool:
    return bool(
        (os.environ.get("RESEND_API_KEY") and os.environ.get("EMAIL_FROM"))
        or (os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))
    )


def new_verification_code(user_id: int, purpose: str = "email_verification") -> tuple[str, str, datetime]:
    """Create a six-digit code and a keyed digest that is safe to persist."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    pepper = os.environ.get("JWT_SECRET", "").encode("utf-8")
    digest = hmac.new(pepper, f"{user_id}:{purpose}:{code}".encode("ascii"), hashlib.sha256).hexdigest()
    return code, digest, datetime.utcnow() + CODE_LIFETIME


def send_verification_email(user: User, code: str, purpose: str = "email_verification") -> None:
    resend_key = os.environ.get("RESEND_API_KEY")
    if resend_key:
        _send_with_resend(user, code, purpose, resend_key)
        return

    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("SMTP_FROM")
    if not email_delivery_configured():
        raise RuntimeError("Email delivery is not configured. Set SMTP_HOST and SMTP_FROM in .env.")

    port = int(os.environ.get("SMTP_PORT", "587"))
    username = os.environ.get("SMTP_USERNAME", "")
    password = os.environ.get("SMTP_PASSWORD", "").replace(" ", "")
    use_ssl = os.environ.get("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes"}
    use_tls = os.environ.get("SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}

    message = EmailMessage()
    is_reset = purpose == "password_reset"
    heading = "Reset your Shabdle password" if is_reset else "Verify your Shabdle email"
    message["Subject"] = f"Your Shabdle {'password reset' if is_reset else 'verification'} code: {code}"
    message["From"] = sender
    message["To"] = user.email
    message.set_content(
        f"{heading}\n\n"
        f"Enter this six-digit code in Shabdle: {code}\n\n"
        "The code expires in 10 minutes.\n\n"
        + ("If you did not request a password reset, you can ignore this email."
           if is_reset else "If you did not create this account, you can ignore this email.")
    )
    message.add_alternative(
        f"<p>{heading}</p>"
        f'<p style="font-size:32px;font-weight:bold;letter-spacing:8px">{code}</p>'
        + ("<p>Use this code to reset your password. It expires in 10 minutes. If you did not request a reset, "
           "you can ignore this email.</p>" if is_reset else
           "<p>Enter this code on Shabdle. It expires in 10 minutes. If you did not create this account, "
           "you can ignore this email.</p>"),
        subtype="html",
    )

    context = ssl.create_default_context()
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as server:
            if username:
                server.login(username, password)
            refused = server.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
        return

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        if use_tls:
            server.starttls(context=context)
            server.ehlo()
        if username:
            server.login(username, password)
        refused = server.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def _send_with_resend(user: User, code: str, purpose: str, api_key: str) -> None:
    sender = os.environ.get("EMAIL_FROM")
    if not sender:
        raise RuntimeError("EMAIL_FROM is required when RESEND_API_KEY is configured.")

    is_reset = purpose == "password_reset"
    heading = "Reset your Shabdle password" if is_reset else "Verify your Shabdle email"
    message = {
        "from": sender,
        "to": [user.email],
        "subject": f"Your Shabdle {'password reset' if is_reset else 'verification'} code: {code}",
        "text": (
            f"{heading}\n\nEnter this six-digit code in Shabdle: {code}\n\n"
            "The code expires in 10 minutes.\n"
        ),
        "html": (
            f'<p>{heading}</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">{code}</p>'
            "<p>The code expires in 10 minutes. If you did not request this, you can ignore this email.</p>"
        ),
    }
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(message).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"Email provider returned HTTP {response.status}.")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Email provider rejected the message (HTTP {error.code}).") from error


def verification_code_matches(user_id: int, code: str, expected_digest: str, purpose: str = "email_verification") -> bool:
    pepper = os.environ.get("JWT_SECRET", "").encode("utf-8")
    actual_digest = hmac.new(
        pepper,
        f"{user_id}:{purpose}:{code}".encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(actual_digest, expected_digest)


def revoke_user_verifications(db, user_id: int, purpose: str | None = None) -> None:
    query = db.query(EmailVerification).filter_by(user_id=user_id)
    if purpose:
        query = query.filter_by(purpose=purpose)
    query.delete(synchronize_session=False)
