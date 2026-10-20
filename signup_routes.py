import re
import secrets
import sqlite3
import time
from collections import defaultdict

from flask import Blueprint, jsonify, request, session, render_template
from werkzeug.security import generate_password_hash

WINDOW = 3600
EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

bp = Blueprint("signup", __name__)
_ctx = {}
_ip_hits = defaultdict(list)


def err(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def now():
    return int(time.time())


def ip_limited(limit=30):
    ip = request.remote_addr or "?"
    t = now()
    hits = [x for x in _ip_hits[ip] if t - x < WINDOW]
    if len(hits) >= limit:
        _ip_hits[ip] = hits
        return True
    hits.append(t)
    _ip_hits[ip] = hits
    return False


def make_username(conn, email):
    base = re.sub(r"[^A-Za-z0-9_]", "", email.split("@")[0])[:20] or "user"
    if len(base) < 3:
        base = (base + "user")[:20]
    cand = base
    while conn.execute("SELECT 1 FROM users WHERE username = ?", (cand,)).fetchone():
        cand = f"{base}{secrets.randbelow(10000):04d}"
    return cand


@bp.post("/api/auth/signup")
def signup():
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

    with _ctx["db"]() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO users
                   (username, email, password_hash, ngn_balance, tck_balance,
                    full_name, account_type)
                   VALUES (?, ?, ?, '0.00', '0.00', ?, ?)""",
                (make_username(conn, email), email,
                 generate_password_hash(password), full_name, account_type),
            )
        except sqlite3.IntegrityError:
            return err("That email is already registered.", 409)
        uid = cur.lastrowid
        row = conn.execute(
            "SELECT id, username, email, ngn_balance, tck_balance "
            "FROM users WHERE id = ?", (uid,)
        ).fetchone()

    session.clear()
    session["user_id"] = uid
    return jsonify({
        "ok": True,
        "message": "Account created.",
        "user": _ctx["user_json"](row),
    }), 201


def setup(app, db_connect, user_json):
    _ctx.update(app=app, db=db_connect, user_json=user_json)

    with db_connect() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        for name, ddl in (
            ("full_name", "full_name TEXT"),
            ("account_type", "account_type TEXT NOT NULL DEFAULT 'personal'"),
            ("email_verified", "email_verified INTEGER NOT NULL DEFAULT 0"),
        ):
            if name not in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN {ddl}")

    app.register_blueprint(bp)

    def old_register_disabled():
        return err("Please use the sign-up page.", 410)
    app.view_functions["register"] = old_register_disabled

    app.add_url_rule(
        "/register", "register_page",
        lambda: render_template("register.html"),
    )
