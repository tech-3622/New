import os
import re
import hmac
import secrets
import sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "tck.db"

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Set TCK_SECRET_KEY in your environment before deployment.
app.secret_key = os.environ.get("TCK_SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("TCK_HTTPS", "0") == "1",
    MAX_CONTENT_LENGTH=16 * 1024,
)

# Development simulation settings only; not real market prices.
RATE = Decimal("50.00")       # NGN per TCK
FEE_RATE = Decimal("0.01")    # 1%
DEMO_NGN = Decimal("500000.00")
DEMO_TCK = Decimal("1000.00")


def money(value):
    return Decimal(str(value)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def db_connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db_connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                ngn_balance TEXT NOT NULL DEFAULT '500000.00',
                tck_balance TEXT NOT NULL DEFAULT '1000.00',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
                amount TEXT NOT NULL,
                fee TEXT NOT NULL,
                received TEXT NOT NULL,
                rate TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'SIMULATED',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)


def error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None

    with db_connect() as db:
        return db.execute(
            "SELECT id, username, email, ngn_balance, tck_balance "
            "FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            session.clear()
            return error("Please log in first.", 401)
        return fn(*args, **kwargs)
    return wrapper


def user_json(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "ngn_balance": str(money(user["ngn_balance"])),
        "tck_balance": str(money(user["tck_balance"])),
        "balance_type": "DEMO",
    }


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "service": "TCK Token API",
        "database": "SQLite",
        "mode": "SIMULATION",
    })


@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}

    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    if not isinstance(password, str):
        return error("Password must be text.")

    if not re.fullmatch(r"[A-Za-z0-9_]{3,30}", username):
        return error(
            "Username must be 3-30 characters using letters, numbers or underscores."
        )

    if len(email) > 254 or not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+", email
    ):
        return error("Enter a valid email address.")

    if len(password) < 8 or len(password) > 128:
        return error("Password must be between 8 and 128 characters.")

    password_hash = generate_password_hash(password)

    try:
        with db_connect() as db:
            cursor = db.execute(
                """INSERT INTO users
                   (username, email, password_hash, ngn_balance, tck_balance)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    username,
                    email,
                    password_hash,
                    str(DEMO_NGN),
                    str(DEMO_TCK),
                )
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return error("That username or email is already registered.", 409)

    session.clear()
    session["user_id"] = user_id

    return jsonify({
        "ok": True,
        "message": "Account created. Demo balances are active.",
        "user": user_json(current_user()),
    }), 201


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = data.get("password", "")

    if not isinstance(password, str) or not email:
        return error("Enter your email and password.")

    with db_connect() as db:
        user = db.execute(
            "SELECT id, password_hash FROM users WHERE email = ?",
            (email,)
        ).fetchone()

    if user is None or not check_password_hash(
        user["password_hash"], password
    ):
        return error("Invalid email or password.", 401)

    session.clear()
    session["user_id"] = user["id"]

    return jsonify({
        "ok": True,
        "message": "Login successful.",
        "user": user_json(current_user()),
    })


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True, "message": "Logged out."})


@app.get("/api/auth/me")
def me():
    user = current_user()
    if user is None:
        return error("Not logged in.", 401)
    return jsonify({"ok": True, "user": user_json(user)})


@app.get("/api/balance")
@login_required
def balance():
    user = current_user()
    return jsonify({"ok": True, "user": user_json(user)})


@app.get("/api/transactions")
@login_required
def transactions():
    user = current_user()

    with db_connect() as db:
        rows = db.execute(
            """SELECT id, side, amount, fee, received, rate,
                      status, created_at
               FROM transactions
               WHERE user_id = ?
               ORDER BY id DESC LIMIT 100""",
            (user["id"],)
        ).fetchall()

    return jsonify({
        "ok": True,
        "transactions": [dict(row) for row in rows],
    })


@app.post("/api/swap")
@login_required
def swap():
    data = request.get_json(silent=True) or {}
    side = str(data.get("side", "")).lower()

    if side not in ("buy", "sell"):
        return error("Side must be buy or sell.")

    try:
        amount = Decimal(str(data.get("amount", "")))
    except (InvalidOperation, ValueError):
        return error("Enter a valid amount.")

    if not amount.is_finite() or amount <= 0:
        return error("Amount must be greater than zero.")

    if amount > Decimal("100000000"):
        return error("Amount exceeds the simulation limit.")

    amount = money(amount)

    if amount <= 0:
        return error("Amount must be at least 0.01.")

    user_id = session.get("user_id")

    try:
        with db_connect() as db:
            db.execute("BEGIN IMMEDIATE")

            user = db.execute(
                "SELECT * FROM users WHERE id = ?",
                (user_id,)
            ).fetchone()

            if user is None:
                session.clear()
                return error("Please log in again.", 401)

            ngn = money(user["ngn_balance"])
            tck = money(user["tck_balance"])

            if side == "buy":
                fee = money(amount * FEE_RATE)
                total_cost = amount
                received = money((amount - fee) / RATE)

                if ngn < total_cost:
                    return error("Insufficient demo NGN balance.")

                new_ngn = money(ngn - total_cost)
                new_tck = money(tck + received)

            else:
                fee = money(amount * FEE_RATE)
                total_cost = amount

                if tck < total_cost:
                    return error("Insufficient demo TCK balance.")

                received = money((amount - fee) * RATE)
                new_tck = money(tck - total_cost)
                new_ngn = money(ngn + received)

            db.execute(
                """UPDATE users
                   SET ngn_balance = ?, tck_balance = ?
                   WHERE id = ?""",
                (str(new_ngn), str(new_tck), user_id)
            )

            cursor = db.execute(
                """INSERT INTO transactions
                   (user_id, side, amount, fee, received, rate, status)
                   VALUES (?, ?, ?, ?, ?, ?, 'SIMULATED')""",
                (
                    user_id,
                    side,
                    str(amount),
                    str(fee),
                    str(received),
                    str(RATE),
                )
            )

            transaction_id = cursor.lastrowid

    except sqlite3.Error:
        app.logger.exception("Swap database error")
        return error("Could not save the order. Please try again.", 500)

    return jsonify({
        "ok": True,
        "message": "Simulated order recorded. No real money was moved.",
        "transaction_id": transaction_id,
        "status": "SIMULATED",
        "side": side,
        "amount": str(amount),
        "fee": str(fee),
        "received": str(received),
        "rate_ngn_per_tck": str(RATE),
        "user": user_json(current_user()),
    })


init_db()

import signup_routes
signup_routes.setup(app, db_connect, user_json)

import dash_routes
dash_routes.setup(app, db_connect, user_json)

import profile_routes
profile_routes.setup(app, db_connect)

import admin_routes
admin_routes.setup(app, db_connect)

import admin_setup
admin_setup.setup(app, db_connect)

import bank_routes
bank_routes.setup(app, db_connect)

import about_routes
about_routes.setup(app)

import news_routes
news_routes.setup(app, db_connect)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
