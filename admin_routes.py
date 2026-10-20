import re
from decimal import Decimal
from functools import wraps

from flask import Blueprint, jsonify, redirect, render_template, session

ADMIN_EMAILS = ["you@email.com"]

bp = Blueprint("admin", __name__)
_db = None

LIST_FIELDS = ["id", "username", "full_name", "email", "account_type",
               "ngn_balance", "tck_balance", "created_at", "is_admin"]
DETAIL_FIELDS = ["id", "username", "full_name", "email", "phone", "state",
                 "address", "account_type", "email_verified", "wallet_address",
                 "bank_name", "bank_account_number", "bank_account_name",
                 "ngn_balance", "tck_balance", "created_at", "is_admin"]


def is_admin_user():
    uid = session.get("user_id")
    if not uid:
        return False
    with _db() as c:
        row = c.execute("SELECT is_admin FROM users WHERE id = ?", (uid,)).fetchone()
    return bool(row and row["is_admin"])


def admin_api(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"ok": False, "error": "Please log in first."}), 401
        if not is_admin_user():
            return jsonify({"ok": False, "error": "Admins only."}), 403
        return fn(*args, **kwargs)
    return wrapper


def pick(c, wanted):
    have = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
    return [x for x in wanted if x in have]


@bp.get("/admin")
def admin_page():
    if not session.get("user_id"):
        return redirect("/login")
    if not is_admin_user():
        return redirect("/dashboard")
    return render_template("admin.html")


@bp.get("/api/admin/check")
def check():
    if not session.get("user_id"):
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "is_admin": is_admin_user()})


@bp.get("/api/admin/overview")
@admin_api
def overview():
    with _db() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        rows = c.execute("SELECT ngn_balance, tck_balance FROM users").fetchall()
        new_today = c.execute(
            "SELECT COUNT(*) FROM users WHERE date(created_at) = date('now')"
        ).fetchone()[0]
        admins = c.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]
        merchants = 0
        if "account_type" in cols:
            merchants = c.execute(
                "SELECT COUNT(*) FROM users WHERE account_type = 'merchant'"
            ).fetchone()[0]
        stakes = c.execute("SELECT amount FROM stakes WHERE status = 'active'").fetchall()
        activity_count = c.execute("SELECT COUNT(*) FROM activity").fetchone()[0]

    zero = Decimal("0")
    cent = Decimal("0.01")
    total_ngn = sum((Decimal(r["ngn_balance"]) for r in rows), zero)
    total_tck = sum((Decimal(r["tck_balance"]) for r in rows), zero)
    staked = sum((Decimal(s["amount"]) for s in stakes), zero)

    return jsonify({"ok": True, "stats": {
        "users": len(rows),
        "new_today": new_today,
        "admins": admins,
        "merchants": merchants,
        "total_ngn": str(total_ngn.quantize(cent)),
        "total_tck": str(total_tck.quantize(cent)),
        "staked_total": str(staked.quantize(cent)),
        "activity_count": activity_count,
    }})


@bp.get("/api/admin/users")
@admin_api
def users():
    with _db() as c:
        cols = pick(c, LIST_FIELDS)
        rows = c.execute(
            "SELECT " + ", ".join(cols) + " FROM users ORDER BY id DESC"
        ).fetchall()
    return jsonify({"ok": True, "users": [dict(r) for r in rows]})


@bp.get("/api/admin/users/<int:uid>")
@admin_api
def user_detail(uid):
    with _db() as c:
        cols = pick(c, DETAIL_FIELDS)
        u = c.execute(
            "SELECT " + ", ".join(cols) + " FROM users WHERE id = ?", (uid,)
        ).fetchone()
        if u is None:
            return jsonify({"ok": False, "error": "User not found."}), 404
        stakes = c.execute(
            "SELECT vault_days, apy, amount, unlock_at, status FROM stakes "
            "WHERE user_id = ? ORDER BY id DESC LIMIT 20", (uid,)
        ).fetchall()
        acts = c.execute(
            "SELECT kind, title, subtitle, tck_delta, ngn_delta, created_at "
            "FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 20", (uid,)
        ).fetchall()
    return jsonify({
        "ok": True,
        "user": dict(u),
        "stakes": [dict(s) for s in stakes],
        "activity": [dict(a) for a in acts],
    })


def setup(app, db_connect):
    global _db
    _db = db_connect
    with db_connect() as c:
        have = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        if "is_admin" not in have:
            c.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    safe = [e.strip().lower() for e in ADMIN_EMAILS
            if re.fullmatch(r"[^@\s'\"]+@[^@\s'\"]+\.[^@\s'\"]+", e.strip())]
    marks = ", ".join("'" + e + "'" for e in safe) or "''"
    with db_connect() as c:
        c.execute("DROP TRIGGER IF EXISTS trg_admin_email")
        c.execute("UPDATE users SET is_admin = CASE WHEN lower(email) IN (" + marks + ") THEN 1 ELSE 0 END")
        c.execute("CREATE TRIGGER trg_admin_email AFTER INSERT ON users WHEN lower(NEW.email) IN ("
                  + marks + ") BEGIN UPDATE users SET is_admin = 1 WHERE id = NEW.id; END")
    app.register_blueprint(bp)
