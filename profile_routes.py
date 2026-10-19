import re
import time
from collections import defaultdict
from functools import wraps

from flask import Blueprint, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
    "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
    "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo",
    "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
]
BANKS = {
    "GTBank": "Guaranty Trust Bank (GTB)",
    "Access": "Access Bank",
    "Zenith": "Zenith Bank",
    "Kuda": "Kuda Microfinance Bank",
    "OPay": "OPay Digital Services",
    "Palmpay": "PalmPay",
    "FirstBank": "First Bank of Nigeria",
    "UBA": "United Bank for Africa (UBA)",
}

bp = Blueprint("profile", __name__)
_db = None
_pw_fails = defaultdict(list)


def err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


def auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = session.get("user_id")
        if not uid:
            return err("Please log in first.", 401)
        return fn(uid, *args, **kwargs)
    return wrapper


@bp.get("/profile")
def profile_page():
    if not session.get("user_id"):
        return redirect("/login")
    return render_template("profile.html")


@bp.get("/api/profile/me")
@auth
def me(uid):
    with _db() as c:
        u = c.execute(
            "SELECT username, full_name, email, phone, state, address, "
            "bank_name, bank_account_number, bank_account_name, "
            "email_verified, wallet_address, created_at FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
    if u is None:
        session.clear()
        return err("Please log in again.", 401)
    bank = None
    if u["bank_name"] and u["bank_account_number"]:
        bank = {
            "key": u["bank_name"],
            "label": BANKS.get(u["bank_name"], u["bank_name"]),
            "number": u["bank_account_number"],
            "account_name": u["bank_account_name"] or "",
        }
    return jsonify({"ok": True, "profile": {
        "username": u["username"],
        "full_name": u["full_name"] or u["username"],
        "email": u["email"],
        "phone": u["phone"] or "",
        "state": u["state"] or "",
        "address": u["address"] or "",
        "bank": bank,
        "email_verified": bool(u["email_verified"]),
        "wallet_address": u["wallet_address"],
        "created_at": u["created_at"],
    }, "states": STATES, "banks": [[k, v] for k, v in BANKS.items()]})


@bp.post("/api/profile/personal")
@auth
def personal(uid):
    d = request.get_json(silent=True) or {}
    full_name = " ".join(str(d.get("full_name", "")).split())
    if not 2 <= len(full_name) <= 80:
        return err("Enter your full name (2-80 characters).")

    phone = re.sub(r"[\s\-]", "", str(d.get("phone", "")))
    if phone:
        if phone.startswith("+234"):
            phone = phone[4:]
        elif phone.startswith("234") and len(phone) == 13:
            phone = phone[3:]
        elif phone.startswith("0"):
            phone = phone[1:]
        if not re.fullmatch(r"[789]\d{9}", phone):
            return err("Enter a valid Nigerian phone number.")

    state = str(d.get("state", "")).strip()
    if state and state not in STATES:
        return err("Choose a valid state.")

    address = " ".join(str(d.get("address", "")).split())
    if len(address) > 200:
        return err("Address is too long (max 200 characters).")

    with _db() as c:
        c.execute(
            "UPDATE users SET full_name = ?, phone = ?, state = ?, address = ? "
            "WHERE id = ?", (full_name, phone, state, address, uid))
    return jsonify({"ok": True, "message": "Personal details saved."})


@bp.post("/api/profile/bank")
@auth
def bank(uid):
    d = request.get_json(silent=True) or {}
    key = str(d.get("bank", "")).strip()
    number = str(d.get("account_number", "")).strip()
    name = " ".join(str(d.get("account_name", "")).split()).upper()

    if key not in BANKS:
        return err("Choose a bank from the list.")
    if not re.fullmatch(r"\d{10}", number):
        return err("Account number must be exactly 10 digits.")
    if not re.fullmatch(r"[A-Z][A-Z .'\-]{1,59}", name):
        return err("Enter the account name (letters only, 2-60 characters).")

    with _db() as c:
        c.execute(
            "UPDATE users SET bank_name = ?, bank_account_number = ?, "
            "bank_account_name = ? WHERE id = ?", (key, number, name, uid))
    return jsonify({"ok": True, "message": "Bank details saved."})


@bp.post("/api/profile/password")
@auth
def password(uid):
    d = request.get_json(silent=True) or {}
    cur = d.get("current_password", "")
    new = d.get("new_password", "")
    if not isinstance(cur, str) or not isinstance(new, str) or not cur:
        return err("Enter your current password.")

    t = int(time.time())
    _pw_fails[uid] = [x for x in _pw_fails[uid] if t - x < 900]
    if len(_pw_fails[uid]) >= 5:
        return err("Too many wrong attempts. Try again in 15 minutes.", 429)

    with _db() as c:
        row = c.execute("SELECT password_hash FROM users WHERE id = ?", (uid,)).fetchone()
        if row is None or not check_password_hash(row["password_hash"], cur):
            _pw_fails[uid].append(t)
            return err("Current password is incorrect.", 403)
        if not 8 <= len(new) <= 128:
            return err("New password must be 8-128 characters.")
        if new == cur:
            return err("New password must be different from the current one.")
        c.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                  (generate_password_hash(new), uid))
    _pw_fails.pop(uid, None)
    return jsonify({"ok": True, "message": "Password updated."})


def setup(app, db_connect):
    global _db
    _db = db_connect
    with db_connect() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        for name in ("phone", "state", "address", "bank_name",
                     "bank_account_number", "bank_account_name"):
            if name not in cols:
                c.execute(f"ALTER TABLE users ADD COLUMN {name} TEXT")
    app.register_blueprint(bp)
