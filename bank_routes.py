import re
import secrets
import time
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
MIN_DEPOSIT = Decimal("500.00")
MAX_DEPOSIT = Decimal("5000000.00")
MIN_WITHDRAW = Decimal("500.00")
MAX_WITHDRAW = Decimal("5000000.00")
MAX_PROOF = 5 * 1024 * 1024

bp = Blueprint("bank", __name__)
_db = None
_pin_fails = defaultdict(list)


def err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


def money(v):
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def parse_amount(v, lo, hi):
    try:
        a = Decimal(str(v).strip())
        if not a.is_finite():
            return None
        a = money(a)
    except (InvalidOperation, ValueError):
        return None
    return a if lo <= a <= hi else None


def auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = session.get("user_id")
        if not uid:
            return err("Please log in first.", 401)
        return fn(uid, *args, **kwargs)
    return wrapper


def admin_only(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = session.get("user_id")
        if not uid:
            return err("Please log in first.", 401)
        with _db() as c:
            row = c.execute("SELECT is_admin FROM users WHERE id = ?", (uid,)).fetchone()
        if not row or not row["is_admin"]:
            return err("Admins only.", 403)
        return fn(*args, **kwargs)
    return wrapper


def image_ext(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def get_settings(c):
    rows = c.execute("SELECT key, value FROM bank_settings").fetchall()
    d = {r["key"]: r["value"] for r in rows}
    return {
        "bank_name": d.get("bank_name", ""),
        "account_number": d.get("account_number", ""),
        "account_name": d.get("account_name", ""),
        "note": d.get("note", ""),
    }


def log_activity(c, uid, kind, title, subtitle, ngn):
    c.execute(
        "INSERT INTO activity (user_id, kind, title, subtitle, tck_delta, ngn_delta) "
        "VALUES (?, ?, ?, ?, '0.00', ?)",
        (uid, kind, title, subtitle, str(money(ngn))),
    )


def blocked(*args, **kwargs):
    return err("Use Bank Cash-In to send a deposit for approval.", 410)


@bp.get("/api/bank/info")
@auth
def info(uid):
    with _db() as c:
        s = get_settings(c)
        u = c.execute(
            "SELECT ngn_balance, pin_hash, bank_name, bank_account_number, bank_account_name "
            "FROM users WHERE id = ?", (uid,)
        ).fetchone()
        if u is None:
            session.clear()
            return err("Please log in again.", 401)
        pd = c.execute(
            "SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'pending'", (uid,)
        ).fetchone()[0]
        pw = c.execute(
            "SELECT COUNT(*) FROM withdrawals WHERE user_id = ? AND status = 'pending'", (uid,)
        ).fetchone()[0]
    bank = None
    if u["bank_name"] and u["bank_account_number"]:
        bank = {
            "bank_name": u["bank_name"],
            "account_number": u["bank_account_number"],
            "account_name": u["bank_account_name"] or "",
        }
    return jsonify({
        "ok": True,
        "deposit_account": s if s["account_number"] else None,
        "has_pin": bool(u["pin_hash"]),
        "bank": bank,
        "balance": str(money(u["ngn_balance"])),
        "min_deposit": str(MIN_DEPOSIT),
        "max_deposit": str(MAX_DEPOSIT),
        "min_withdraw": str(MIN_WITHDRAW),
        "max_withdraw": str(MAX_WITHDRAW),
        "pending_deposits": pd,
        "pending_withdrawals": pw,
    })


@bp.post("/api/bank/pin")
@auth
def set_pin(uid):
    d = request.get_json(silent=True) or {}
    pin = str(d.get("pin", ""))
    if not re.fullmatch(r"\d{4}", pin):
        return err("PIN must be exactly 4 digits.")
    with _db() as c:
        row = c.execute("SELECT pin_hash FROM users WHERE id = ?", (uid,)).fetchone()
        if row is None:
            return err("Please log in again.", 401)
        if row["pin_hash"]:
            return err("Your PIN is already set.", 409)
        c.execute("UPDATE users SET pin_hash = ? WHERE id = ?", (generate_password_hash(pin), uid))
    return jsonify({"ok": True, "message": "PIN saved."})


@bp.post("/api/bank/deposit")
@auth
def deposit(uid):
    amt = parse_amount(request.form.get("amount"), MIN_DEPOSIT, MAX_DEPOSIT)
    if amt is None:
        return err(f"Enter an amount between ₦{MIN_DEPOSIT:,.0f} and ₦{MAX_DEPOSIT:,.0f}.")
    f = request.files.get("proof")
    if f is None or not f.filename:
        return err("Upload your payment screenshot first.")
    data = f.read(MAX_PROOF + 1)
    if len(data) > MAX_PROOF:
        return err("Screenshot is too big (max 5MB).")
    ext = image_ext(data)
    if ext is None:
        return err("Screenshot must be a PNG, JPG or WEBP image.")
    with _db() as c:
        s = get_settings(c)
        if not s["account_number"]:
            return err("Deposits are not open yet. Try again later.", 503)
        pending = c.execute(
            "SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'pending'", (uid,)
        ).fetchone()[0]
        if pending >= 3:
            return err("You already have 3 deposits waiting for approval.")
        name = secrets.token_hex(16) + ext
        (UPLOAD_DIR / name).write_bytes(data)
        c.execute(
            "INSERT INTO deposits (user_id, amount, proof) VALUES (?, ?, ?)",
            (uid, str(amt), name),
        )
        log_activity(c, uid, "deposit", "Deposit Pending", f"₦{amt:,.2f} waiting for approval", 0)
    return jsonify({"ok": True, "message": "Payment received. We are confirming it now."})


@bp.post("/api/bank/withdraw")
@auth
def withdraw(uid):
    d = request.get_json(silent=True) or {}
    amt = parse_amount(d.get("amount"), MIN_WITHDRAW, MAX_WITHDRAW)
    if amt is None:
        return err(f"Enter an amount between ₦{MIN_WITHDRAW:,.0f} and ₦{MAX_WITHDRAW:,.0f}.")
    pin = str(d.get("pin", ""))
    t = int(time.time())
    _pin_fails[uid] = [x for x in _pin_fails[uid] if t - x < 900]
    if len(_pin_fails[uid]) >= 5:
        return err("Too many wrong PIN attempts. Try again in 15 minutes.", 429)
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        u = c.execute(
            "SELECT ngn_balance, pin_hash, bank_name, bank_account_number, bank_account_name "
            "FROM users WHERE id = ?", (uid,)
        ).fetchone()
        if u is None:
            return err("Please log in again.", 401)
        if not u["pin_hash"]:
            return err("Set your withdrawal PIN first.", 403)
        if not u["bank_name"] or not u["bank_account_number"]:
            return err("Save your bank details in your Profile first.")
        if not check_password_hash(u["pin_hash"], pin):
            _pin_fails[uid].append(t)
            return err("Wrong PIN.", 403)
        _pin_fails.pop(uid, None)
        ngn = money(u["ngn_balance"])
        if ngn < amt:
            return err("Insufficient NGN balance.")
        c.execute("UPDATE users SET ngn_balance = ? WHERE id = ?", (str(ngn - amt), uid))
        c.execute(
            "INSERT INTO withdrawals (user_id, amount, bank_name, account_number, account_name) "
            "VALUES (?, ?, ?, ?, ?)",
            (uid, str(amt), u["bank_name"], u["bank_account_number"], u["bank_account_name"] or ""),
        )
        log_activity(c, uid, "withdraw", "Withdrawal Pending", f"₦{amt:,.2f} waiting for approval", -amt)
    return jsonify({"ok": True, "message": "Withdrawal request sent. We are processing it."})


@bp.get("/api/bank/history")
@auth
def history(uid):
    with _db() as c:
        dep = c.execute(
            "SELECT id, amount, status, admin_note, created_at FROM deposits "
            "WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)
        ).fetchall()
        wd = c.execute(
            "SELECT id, amount, status, admin_note, created_at, bank_name, account_number "
            "FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)
        ).fetchall()
    items = []
    for r in dep:
        items.append({
            "type": "deposit", "id": r["id"], "amount": str(money(r["amount"])),
            "status": r["status"], "note": r["admin_note"], "created_at": r["created_at"],
            "detail": "Bank transfer",
        })
    for r in wd:
        items.append({
            "type": "withdrawal", "id": r["id"], "amount": str(money(r["amount"])),
            "status": r["status"], "note": r["admin_note"], "created_at": r["created_at"],
            "detail": f"{r['bank_name']} ****{r['account_number'][-4:]}",
        })
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return jsonify({"ok": True, "history": items[:60]})


@bp.get("/api/admin/bank/settings")
@admin_only
def admin_get_settings():
    with _db() as c:
        return jsonify({"ok": True, "settings": get_settings(c)})


@bp.post("/api/admin/bank/settings")
@admin_only
def admin_save_settings():
    d = request.get_json(silent=True) or {}
    bank_name = " ".join(str(d.get("bank_name", "")).split())
    account_number = re.sub(r"\s", "", str(d.get("account_number", "")))
    account_name = " ".join(str(d.get("account_name", "")).split())
    note = " ".join(str(d.get("note", "")).split())
    if not 2 <= len(bank_name) <= 60:
        return err("Enter the bank name.")
    if not re.fullmatch(r"\d{6,20}", account_number):
        return err("Account number must be digits only.")
    if not 2 <= len(account_name) <= 80:
        return err("Enter the account name.")
    if len(note) > 200:
        return err("Note is too long (max 200 characters).")
    with _db() as c:
        for k, v in (("bank_name", bank_name), ("account_number", account_number),
                     ("account_name", account_name), ("note", note)):
            c.execute("INSERT OR REPLACE INTO bank_settings (key, value) VALUES (?, ?)", (k, v))
    return jsonify({"ok": True, "message": "Deposit account saved."})


@bp.get("/api/admin/deposits")
@admin_only
def admin_deposits():
    with _db() as c:
        rows = c.execute(
            "SELECT d.id, d.user_id, d.amount, d.status, d.admin_note, d.created_at, "
            "d.reviewed_at, u.username, u.full_name, u.email "
            "FROM deposits d JOIN users u ON u.id = d.user_id "
            "ORDER BY (d.status = 'pending') DESC, d.id DESC LIMIT 200"
        ).fetchall()
    return jsonify({"ok": True, "deposits": [dict(r) for r in rows]})


@bp.get("/api/admin/withdrawals")
@admin_only
def admin_withdrawals():
    with _db() as c:
        rows = c.execute(
            "SELECT w.id, w.user_id, w.amount, w.bank_name, w.account_number, w.account_name, "
            "w.status, w.admin_note, w.created_at, w.reviewed_at, u.username, u.full_name, u.email "
            "FROM withdrawals w JOIN users u ON u.id = w.user_id "
            "ORDER BY (w.status = 'pending') DESC, w.id DESC LIMIT 200"
        ).fetchall()
    return jsonify({"ok": True, "withdrawals": [dict(r) for r in rows]})


@bp.get("/api/admin/proof/<int:rid>")
@admin_only
def proof(rid):
    with _db() as c:
        row = c.execute("SELECT proof FROM deposits WHERE id = ?", (rid,)).fetchone()
    if row is None:
        return err("Not found.", 404)
    return send_from_directory(UPLOAD_DIR, row["proof"])


def review(kind, rid, approve):
    d = request.get_json(silent=True) or {}
    note = " ".join(str(d.get("note", "")).split())[:200]
    status = "approved" if approve else "declined"
    table = "deposits" if kind == "deposit" else "withdrawals"
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(f"SELECT * FROM {table} WHERE id = ?", (rid,)).fetchone()
        if row is None:
            return err("Request not found.", 404)
        if row["status"] != "pending":
            return err("This request was already reviewed.", 409)
        amt = money(row["amount"])
        uid = row["user_id"]
        bal = c.execute("SELECT ngn_balance FROM users WHERE id = ?", (uid,)).fetchone()
        if bal is None:
            return err("User not found.", 404)
        ngn = money(bal["ngn_balance"])
        if kind == "deposit" and approve:
            c.execute("UPDATE users SET ngn_balance = ? WHERE id = ?", (str(ngn + amt), uid))
            log_activity(c, uid, "deposit", "Deposit Approved", f"₦{amt:,.2f} added to your wallet", amt)
        elif kind == "deposit":
            log_activity(c, uid, "deposit", "Deposit Declined", note or "Your deposit was not approved", 0)
        elif approve:
            log_activity(c, uid, "withdraw", "Withdrawal Approved", f"₦{amt:,.2f} sent to your bank", 0)
        else:
            c.execute("UPDATE users SET ngn_balance = ? WHERE id = ?", (str(ngn + amt), uid))
            log_activity(c, uid, "withdraw", "Withdrawal Declined", f"₦{amt:,.2f} returned to your wallet", amt)
        c.execute(
            f"UPDATE {table} SET status = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, note, rid),
        )
    return jsonify({"ok": True, "message": f"Request {status}."})


@bp.post("/api/admin/deposits/<int:rid>/approve")
@admin_only
def dep_approve(rid):
    return review("deposit", rid, True)


@bp.post("/api/admin/deposits/<int:rid>/decline")
@admin_only
def dep_decline(rid):
    return review("deposit", rid, False)


@bp.post("/api/admin/withdrawals/<int:rid>/approve")
@admin_only
def wd_approve(rid):
    return review("withdrawal", rid, True)


@bp.post("/api/admin/withdrawals/<int:rid>/decline")
@admin_only
def wd_decline(rid):
    return review("withdrawal", rid, False)


def setup(app, db_connect):
    global _db
    _db = db_connect
    UPLOAD_DIR.mkdir(exist_ok=True)
    with db_connect() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        if "pin_hash" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN pin_hash TEXT")
        c.execute("""CREATE TABLE IF NOT EXISTS bank_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount TEXT NOT NULL,
            proof TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            admin_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id))""")
        c.execute("""CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount TEXT NOT NULL,
            bank_name TEXT NOT NULL,
            account_number TEXT NOT NULL,
            account_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            admin_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id))""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, id)")
    app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024
    app.register_error_handler(413, lambda e: err("File is too large (max 5MB).", 413))
    app.register_blueprint(bp)
    app.view_functions["dash.deposit"] = blocked
