import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from collections import defaultdict
from decimal import Decimal
from email.message import EmailMessage

from flask import Blueprint, jsonify, request, session, render_template
from werkzeug.security import generate_password_hash

CODE_TTL = 600          # code valid for 10 minutes
RESEND_COOLDOWN = 60    # seconds between sends
MAX_SENDS = 4           # 1 initial + 3 resends per window
MAX_ATTEMPTS = 5        # wrong guesses per code
WINDOW = 3600           # send-count window (1 hour)
WELCOME_BONUS = Decimal("0.00")
EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

bp = Blueprint("verify", __name__)
_ctx = {}
_ip_hits = defaultdict(list)


class MailNotConfigured(Exception):
    pass


def err(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def now():
    return int(time.time())


def hash_code(salt, code):
    return hmac.new(salt.encode(), code.encode(), hashlib.sha256).hexdigest()


def ip_limited(limit=10):
    ip = request.remote_addr or "?"
    t = now()
    hits = [x for x in _ip_hits[ip] if t - x < WINDOW]
    if len(hits) >= limit:
        _ip_hits[ip] = hits
        return True
    hits.append(t)
    _ip_hits[ip] = hits
    return False


def send_code_email(to_addr, code, full_name):
    user = os.environ.get("TCK_SMTP_USER")
    pw = os.environ.get("TCK_SMTP_PASS")
    host = os.environ.get("TCK_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("TCK_SMTP_PORT", "465"))

    if not user or not pw:
        if os.environ.get("TCK_DEV_CODES") == "1":
            print(f"[DEV] verification code for {to_addr}: {code}")
            return
        raise MailNotConfigured()

    msg = EmailMessage()
    msg["Subject"] = "Your TCK verification code"
    msg["From"] = user
    msg["To"] = to_addr
    msg.set_content(
        f"Hi {full_name},\n\n"
        f"Your TCK Token verification code is: {code}\n\n"
        f"It expires in {CODE_TTL // 60} minutes. "
        f"If you didn't request this, ignore this email.\n"
    )

    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as s:
            s.login(user, pw)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.starttls(context=ctx)
            s.login(user, pw)
            s.send_message(msg)


def make_username(conn, email):
    base = re.sub(r"[^A-Za-z0-9_]", "", email.split("@")[0])[:20] or "user"
    if len(base) < 3:
        base = (base + "user")[:20]
    cand = base
    while conn.execute(
        "SELECT 1 FROM users WHERE username = ?", (cand,)
    ).fetchone():
        cand = f"{base}{secrets.randbelow(10000):04d}"
    return cand


@bp.post("/api/auth/register/start")
def start():
    d = request.get_json(silent=True) or {}
    full_name = " ".join(str(d.get("full_name", "")).split())
    email = str(d.get("email", "")).strip().lower()
    password = d.get("password", "")
    account_type = str(d.get("account_type", "personal")).lower()

    if not isinstance(password, str):
        return err("Password must be text.")
    if not 2 <= len(full_name) <= 80:
        return err("Enter your full name (2-80 characters).")
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        return err("Enter a valid email address.")
    if not 8 <= len(password) <= 128:
        return err("Password must be between 8 and 128 characters.")
    if account_type not in ("personal", "merchant"):
        return err("Invalid account type.")
    if ip_limited():
        return err("Too many attempts. Try again later.", 429)

    t = now()
    with _ctx["db"]() as conn:
        if conn.execute(
            "SELECT 1 FROM users WHERE email = ?", (email,)
        ).fetchone():
            return err("That email is already registered.", 409)

        p = conn.execute(
            "SELECT * FROM pending_registrations WHERE email = ?", (email,)
        ).fetchone()

        sends, created = 0, t
        if p and t - p["created_at"] < WINDOW:
            wait = RESEND_COOLDOWN - (t - p["last_sent_at"])
            if wait > 0:
                return err(f"Please wait {wait}s before requesting another code.", 429)
            if p["send_count"] >= MAX_SENDS:
                return err("Too many codes requested. Try again in an hour.", 429)
            sends, created = p["send_count"], p["created_at"]

        code = f"{secrets.randbelow(10**6):06d}"
        try:
            send_code_email(email, code, full_name)
        except MailNotConfigured:
            return err("Email sending is not configured on the server.", 503)
        except Exception:
            _ctx["app"].logger.exception("Email send failed")
            return err("Could not send the email. Try again.", 502)

        salt = secrets.token_hex(8)
        conn.execute(
            """INSERT OR REPLACE INTO pending_registrations
               (email, full_name, account_type, password_hash, code_salt,
                code_hash, expires_at, attempts, send_count,
                last_sent_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)""",
            (email, full_name, account_type,
             generate_password_hash(password), salt,
             hash_code(salt, code), t + CODE_TTL, sends + 1, t, created),
        )

    return jsonify({
        "ok": True,
        "message": "Verification code sent.",
        "expires_in": CODE_TTL,
        "resend_in": RESEND_COOLDOWN,
        "resends_left": MAX_SENDS - (sends + 1),
    })


@bp.post("/api/auth/register/resend")
def resend():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    t = now()

    with _ctx["db"]() as conn:
        p = conn.execute(
            "SELECT * FROM pending_registrations WHERE email = ?", (email,)
        ).fetchone()
        if p is None or t - p["created_at"] >= WINDOW:
            return err("Registration expired. Please start again.", 410)

        wait = RESEND_COOLDOWN - (t - p["last_sent_at"])
        if wait > 0:
            return err(f"Please wait {wait}s before requesting another code.", 429)
        if p["send_count"] >= MAX_SENDS:
            return err("Resend limit reached. Try again in an hour.", 429)

        code = f"{secrets.randbelow(10**6):06d}"
        try:
            send_code_email(email, code, p["full_name"])
        except MailNotConfigured:
            return err("Email sending is not configured on the server.", 503)
        except Exception:
            _ctx["app"].logger.exception("Email resend failed")
            return err("Could not send the email. Try again.", 502)

        salt = secrets.token_hex(8)
        conn.execute(
            """UPDATE pending_registrations
               SET code_salt = ?, code_hash = ?, expires_at = ?,
                   attempts = 0, send_count = send_count + 1,
                   last_sent_at = ?
               WHERE email = ?""",
            (salt, hash_code(salt, code), t + CODE_TTL, t, email),
        )

    return jsonify({
        "ok": True,
        "message": "A new code has been sent.",
        "resend_in": RESEND_COOLDOWN,
        "resends_left": MAX_SENDS - (p["send_count"] + 1),
    })


@bp.post("/api/auth/register/verify")
def verify():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    code = re.sub(r"\D", "", str(d.get("code", "")))
    if len(code) != 6:
        return err("Enter the 6-digit code.")

    t = now()
    with _ctx["db"]() as conn:
        conn.execute("BEGIN IMMEDIATE")
        p = conn.execute(
            "SELECT * FROM pending_registrations WHERE email = ?", (email,)
        ).fetchone()
        if p is None:
            return err("No pending registration. Please start again.", 400)
        if t > p["expires_at"]:
            return err("Code expired. Tap Resend Code.", 410)
        if p["attempts"] >= MAX_ATTEMPTS:
            return err("Too many wrong attempts. Tap Resend Code for a new one.", 429)

        if not hmac.compare_digest(hash_code(p["code_salt"], code), p["code_hash"]):
            conn.execute(
                "UPDATE pending_registrations SET attempts = attempts + 1 "
                "WHERE email = ?", (email,)
            )
            left = MAX_ATTEMPTS - p["attempts"] - 1
            return err(f"Wrong code. {left} attempt(s) left.", 400)

        try:
            cur = conn.execute(
                """INSERT INTO users
                   (username, email, password_hash, ngn_balance, tck_balance,
                    full_name, account_type, email_verified)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
                (make_username(conn, email), email, p["password_hash"],
                 str(_ctx["demo_ngn"]), str(_ctx["demo_tck"]),
                 p["full_name"], p["account_type"]),
            )
        except sqlite3.IntegrityError:
            conn.execute(
                "DELETE FROM pending_registrations WHERE email = ?", (email,)
            )
            return err("That email is already registered.", 409)

        uid = cur.lastrowid

        # UNIQUE(user_id, kind) guarantees only one welcome bonus per user.
        b = conn.execute(
            "INSERT OR IGNORE INTO bonus_ledger (user_id, kind, amount) "
            "VALUES (?, 'welcome', ?)", (uid, str(WELCOME_BONUS))
        )
        granted = b.rowcount == 1
        if granted:
            conn.execute(
                "UPDATE users SET welcome_bonus_tck = ? WHERE id = ?",
                (str(WELCOME_BONUS), uid),
            )

        conn.execute(
            "DELETE FROM pending_registrations WHERE email = ?", (email,)
        )
        row = conn.execute(
            "SELECT id, username, email, ngn_balance, tck_balance "
            "FROM users WHERE id = ?", (uid,)
        ).fetchone()

    session.clear()
    session["user_id"] = uid

    return jsonify({
        "ok": True,
        "message": "Email verified. Account created.",
        "user": _ctx["user_json"](row),
        "bonus_granted": granted,
        "welcome_bonus_tck": str(WELCOME_BONUS) if granted else "0.00",
    }), 201


def setup(app, db_connect, user_json, demo_ngn, demo_tck):
    _ctx.update(app=app, db=db_connect, user_json=user_json,
                demo_ngn=demo_ngn, demo_tck=demo_tck)

    with db_connect() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        for name, ddl in (
            ("full_name", "full_name TEXT"),
            ("account_type", "account_type TEXT NOT NULL DEFAULT 'personal'"),
            ("email_verified", "email_verified INTEGER NOT NULL DEFAULT 0"),
            ("welcome_bonus_tck", "welcome_bonus_tck TEXT NOT NULL DEFAULT '0.00'"),
        ):
            if name not in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN {ddl}")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS pending_registrations (
                email TEXT PRIMARY KEY COLLATE NOCASE,
                full_name TEXT NOT NULL,
                account_type TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                code_salt TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                send_count INTEGER NOT NULL DEFAULT 1,
                last_sent_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS bonus_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                amount TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, kind),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)

    app.register_blueprint(bp)

    # Old register skipped verification, so it must be closed.
    def old_register_disabled():
        return err("Registration now requires email verification.", 410)
    app.view_functions["register"] = old_register_disabled

    app.add_url_rule(
        "/register", "register_page",
        lambda: render_template("register.html"),
    )
