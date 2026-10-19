import re
import sqlite3
import time
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps

from flask import Blueprint, jsonify, redirect, render_template, request, session

RATE = Decimal("50.00")
FEE_RATE = Decimal("0.01")
MAX_AMT = Decimal("100000000")
DEPOSIT_MAX = Decimal("1000000")
VAULTS = {30: Decimal("12.0"), 90: Decimal("18.5")}
EARLY_PENALTY = Decimal("0.02")
YEAR = 365 * 86400
WALLET_RE = re.compile(r"0x[0-9a-fA-F]{40}")

bp = Blueprint("dash", __name__)
_db = None
_fails = defaultdict(list)


def now():
    return int(time.time())


def money(v):
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


def parse_amount(v, minimum=Decimal("0.01"), maximum=MAX_AMT):
    try:
        a = Decimal(str(v).strip())
        if not a.is_finite():
            return None
        a = money(a)
    except (InvalidOperation, ValueError):
        return None
    return a if minimum <= a <= maximum else None


def auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        uid = session.get("user_id")
        if not uid:
            return err("Please log in first.", 401)
        return fn(uid, *args, **kwargs)
    return wrapper


def log(c, uid, kind, title, subtitle, tck="0", ngn="0"):
    c.execute(
        "INSERT INTO activity (user_id, kind, title, subtitle, tck_delta, ngn_delta) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (uid, kind, title, subtitle, str(money(tck)), str(money(ngn))),
    )


def balances(c, uid):
    u = c.execute(
        "SELECT ngn_balance, tck_balance, account_type FROM users WHERE id = ?", (uid,)
    ).fetchone()
    if u is None:
        return None
    return money(u["ngn_balance"]), money(u["tck_balance"]), u["account_type"]


def set_bal(c, uid, ngn=None, tck=None):
    if ngn is not None:
        c.execute("UPDATE users SET ngn_balance = ? WHERE id = ?", (str(money(ngn)), uid))
    if tck is not None:
        c.execute("UPDATE users SET tck_balance = ? WHERE id = ?", (str(money(tck)), uid))


def accrued(s, t):
    end = min(t, s["unlock_at"])
    secs = max(0, end - s["last_claim_at"])
    return money(Decimal(s["amount"]) * Decimal(s["apy"]) / 100 * secs / YEAR)


# ---------- pages ----------
@bp.get("/login")
def login_page():
    return render_template("login.html")


@bp.get("/dashboard")
def dashboard_page():
    if not session.get("user_id"):
        return redirect("/login")
    return render_template("dashboard.html")


# ---------- data ----------
@bp.get("/api/dash/me")
@auth
def me(uid):
    t = now()
    with _db() as c:
        u = c.execute(
            "SELECT username, full_name, email, account_type, wallet_address, "
            "ngn_balance, tck_balance FROM users WHERE id = ?", (uid,)
        ).fetchone()
        if u is None:
            session.clear()
            return err("Please log in again.", 401)
        st = c.execute(
            "SELECT * FROM stakes WHERE user_id = ? AND status = 'active'", (uid,)
        ).fetchall()
        pos = c.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(CAST(tck_delta AS REAL)), 0) AS v "
            "FROM activity WHERE user_id = ? AND kind = 'pos_sale' "
            "AND date(created_at) = date('now')", (uid,)
        ).fetchone()
    return jsonify({"ok": True, "user": {
        "username": u["username"],
        "full_name": u["full_name"] or u["username"],
        "email": u["email"],
        "account_type": u["account_type"],
        "wallet_address": u["wallet_address"],
        "ngn_balance": str(money(u["ngn_balance"])),
        "tck_balance": str(money(u["tck_balance"])),
        "staked": str(money(sum((Decimal(s["amount"]) for s in st), Decimal("0")))),
        "rewards": str(money(sum((accrued(s, t) for s in st), Decimal("0")))),
        "pos_today": {
            "count": pos["n"],
            "volume_ngn": str(money(Decimal(str(pos["v"])) * RATE)),
        },
        "rate": str(RATE),
    }})


@bp.get("/api/dash/activity")
@auth
def activity_feed(uid):
    with _db() as c:
        rows = c.execute(
            "SELECT id, kind, title, subtitle, tck_delta, ngn_delta, created_at "
            "FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)
        ).fetchall()
    return jsonify({"ok": True, "activity": [dict(r) for r in rows]})


# ---------- money actions ----------
@bp.post("/api/dash/swap")
@auth
def swap(uid):
    d = request.get_json(silent=True) or {}
    side = str(d.get("side", "")).lower()
    if side not in ("buy", "sell"):
        return err("Side must be buy or sell.")
    amt = parse_amount(d.get("amount"))
    if amt is None:
        return err("Enter a valid amount.")
    fee = money(amt * FEE_RATE)

    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        b = balances(c, uid)
        if b is None:
            return err("Please log in again.", 401)
        ngn, tck, _ = b
        if side == "buy":
            got = money((amt - fee) / RATE)
            if ngn < amt:
                return err("Insufficient NGN balance. Use Bank Cash-In first.")
            if got <= 0:
                return err("Amount too small.")
            set_bal(c, uid, ngn=ngn - amt, tck=tck + got)
            log(c, uid, "swap", "Bought TCK", f"Exchanged ₦{amt:,.2f} NGN", got, -amt)
            msg = f"Bought {got:,.2f} TCK for ₦{amt:,.2f}."
        else:
            got = money((amt - fee) * RATE)
            if tck < amt:
                return err("Insufficient TCK balance.")
            if got <= 0:
                return err("Amount too small.")
            set_bal(c, uid, ngn=ngn + got, tck=tck - amt)
            log(c, uid, "swap", "Sold TCK", f"Received ₦{got:,.2f} NGN", -amt, got)
            msg = f"Sold {amt:,.2f} TCK for ₦{got:,.2f}."
    return jsonify({"ok": True, "message": msg})


@bp.post("/api/dash/send")
@auth
def send(uid):
    d = request.get_json(silent=True) or {}
    to = str(d.get("to", "")).strip()
    amt = parse_amount(d.get("amount"))
    if not to:
        return err("Enter a recipient address or @username.")
    if amt is None:
        return err("Enter a valid amount.")

    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        b = balances(c, uid)
        if b is None:
            return err("Please log in again.", 401)
        _, tck, _ = b
        if WALLET_RE.fullmatch(to):
            r = c.execute(
                "SELECT id, username, tck_balance FROM users WHERE wallet_address = ?",
                (to.lower(),),
            ).fetchone()
        else:
            r = c.execute(
                "SELECT id, username, tck_balance FROM users WHERE username = ?",
                (to.lstrip("@"),),
            ).fetchone()
        if r is None:
            return err("Recipient not found.", 404)
        if r["id"] == uid:
            return err("You can't send TCK to yourself.")
        if tck < amt:
            return err("Insufficient TCK balance.")

        me_name = c.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()["username"]
        set_bal(c, uid, tck=tck - amt)
        set_bal(c, r["id"], tck=money(r["tck_balance"]) + amt)
        log(c, uid, "send", "Sent TCK", f"To @{r['username']}", -amt)
        log(c, r["id"], "receive", "Payment Received", f"From @{me_name}", amt)
    return jsonify({"ok": True, "message": f"Sent {amt:,.2f} TCK to @{r['username']}."})


@bp.post("/api/dash/deposit")
@auth
def deposit(uid):
    d = request.get_json(silent=True) or {}
    amt = parse_amount(d.get("amount"), maximum=DEPOSIT_MAX)
    if amt is None:
        return err("Enter an amount between ₦0.01 and ₦1,000,000.")
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        b = balances(c, uid)
        if b is None:
            return err("Please log in again.", 401)
        set_bal(c, uid, ngn=b[0] + amt)
        log(c, uid, "deposit", "Bank Cash-In (Simulated)", "Demo NGN credit", 0, amt)
    return jsonify({"ok": True, "message": f"₦{amt:,.2f} demo NGN added."})


@bp.post("/api/dash/pos-sale")
@auth
def pos_sale(uid):
    d = request.get_json(silent=True) or {}
    amt = parse_amount(d.get("amount_ngn"))
    if amt is None:
        return err("Enter a valid sale amount.")
    tck = money(amt / RATE)
    if tck < Decimal("0.01"):
        return err("Sale amount too small.")
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        b = balances(c, uid)
        if b is None:
            return err("Please log in again.", 401)
        if b[2] != "merchant":
            return err("Only Merchant accounts can use the POS.", 403)
        set_bal(c, uid, tck=b[1] + tck)
        log(c, uid, "pos_sale", "POS Terminal Sale",
            f"Customer payment (₦{amt:,.2f}) - simulated", tck)
    return jsonify({"ok": True, "message": f"Payment of ₦{amt:,.2f} ({tck:,.2f} TCK) received."})


# ---------- staking ----------
@bp.get("/api/dash/stakes")
@auth
def stakes_list(uid):
    t = now()
    with _db() as c:
        rows = c.execute(
            "SELECT * FROM stakes WHERE user_id = ? AND status = 'active' ORDER BY id DESC",
            (uid,),
        ).fetchall()
    return jsonify({"ok": True, "stakes": [{
        "id": s["id"], "vault_days": s["vault_days"], "apy": s["apy"],
        "amount": s["amount"], "unlock_at": s["unlock_at"],
        "accrued": str(accrued(s, t)), "matured": t >= s["unlock_at"],
    } for s in rows]})


@bp.post("/api/dash/stake")
@auth
def stake(uid):
    d = request.get_json(silent=True) or {}
    try:
        days = int(d.get("vault"))
    except (TypeError, ValueError):
        return err("Choose a vault.")
    if days not in VAULTS:
        return err("Choose a vault.")
    amt = parse_amount(d.get("amount"), minimum=Decimal("1.00"))
    if amt is None:
        return err("Minimum stake is 1.00 TCK.")
    t = now()
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        b = balances(c, uid)
        if b is None:
            return err("Please log in again.", 401)
        if b[1] < amt:
            return err("Insufficient TCK balance.")
        set_bal(c, uid, tck=b[1] - amt)
        c.execute(
            "INSERT INTO stakes (user_id, vault_days, apy, amount, started_at, "
            "unlock_at, last_claim_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
            (uid, days, str(VAULTS[days]), str(amt), t, t + days * 86400, t),
        )
        log(c, uid, "stake", "Staked TCK", f"{days}-Day Vault ({VAULTS[days]}% APY)", -amt)
    return jsonify({"ok": True, "message": f"Staked {amt:,.2f} TCK in the {days}-day vault."})


@bp.post("/api/dash/claim")
@auth
def claim(uid):
    t = now()
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        st = c.execute(
            "SELECT * FROM stakes WHERE user_id = ? AND status = 'active'", (uid,)
        ).fetchall()
        total = Decimal("0.00")
        for s in st:
            a = accrued(s, t)
            if a > 0:
                total += a
                c.execute("UPDATE stakes SET last_claim_at = ? WHERE id = ?",
                          (min(t, s["unlock_at"]), s["id"]))
        if total < Decimal("0.01"):
            return err("No rewards to claim yet.")
        b = balances(c, uid)
        set_bal(c, uid, tck=b[1] + total)
        log(c, uid, "staking", "Staking Reward Payout", "Rewards claimed", total)
    return jsonify({"ok": True, "message": f"Claimed {total:,.2f} TCK in rewards."})


@bp.post("/api/dash/unstake")
@auth
def unstake(uid):
    d = request.get_json(silent=True) or {}
    t = now()
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        s = c.execute(
            "SELECT * FROM stakes WHERE id = ? AND user_id = ? AND status = 'active'",
            (d.get("id"), uid),
        ).fetchone()
        if s is None:
            return err("Stake not found.", 404)
        amt = Decimal(s["amount"])
        acc = accrued(s, t)
        penalty = money(amt * EARLY_PENALTY) if t < s["unlock_at"] else Decimal("0.00")
        back = money(amt - penalty + acc)
        c.execute("UPDATE stakes SET status = 'closed', last_claim_at = ? WHERE id = ?",
                  (min(t, s["unlock_at"]), s["id"]))
        b = balances(c, uid)
        set_bal(c, uid, tck=b[1] + back)
        log(c, uid, "unstake", "Unstaked TCK",
            "Early exit (2% penalty)" if penalty else "Vault matured", back)
    return jsonify({"ok": True, "message": f"Returned {back:,.2f} TCK to your wallet."})


# ---------- governance ----------
@bp.get("/api/dash/proposals")
@auth
def proposals(uid):
    out = []
    with _db() as c:
        for p in c.execute("SELECT id, label, title, status FROM proposals ORDER BY id"):
            def cnt(ch):
                return c.execute(
                    "SELECT COUNT(*) FROM votes WHERE proposal_id = ? AND choice = ?",
                    (p["id"], ch)).fetchone()[0]
            mine = c.execute(
                "SELECT choice FROM votes WHERE proposal_id = ? AND user_id = ?",
                (p["id"], uid)).fetchone()
            out.append({"id": p["id"], "label": p["label"], "title": p["title"],
                        "status": p["status"], "yes": cnt("yes"), "no": cnt("no"),
                        "my_vote": mine["choice"] if mine else None})
    return jsonify({"ok": True, "proposals": out})


@bp.post("/api/dash/vote")
@auth
def vote(uid):
    d = request.get_json(silent=True) or {}
    choice = str(d.get("choice", "")).lower()
    if choice not in ("yes", "no"):
        return err("Choose yes or no.")
    try:
        with _db() as c:
            p = c.execute("SELECT status FROM proposals WHERE id = ?",
                          (d.get("proposal_id"),)).fetchone()
            if p is None:
                return err("Proposal not found.", 404)
            if p["status"] != "open":
                return err("Voting is closed for this proposal.")
            c.execute("INSERT INTO votes (user_id, proposal_id, choice) VALUES (?, ?, ?)",
                      (uid, d.get("proposal_id"), choice))
    except sqlite3.IntegrityError:
        return err("You already voted on this proposal.", 409)
    return jsonify({"ok": True, "message": f"Vote {choice.upper()} recorded."})


# ---------- setup ----------
def guard_login(app):
    orig = app.view_functions["login"]

    def guarded():
        d = request.get_json(silent=True) or {}
        key = (request.remote_addr or "?", str(d.get("email", "")).strip().lower())
        t = now()
        _fails[key] = [x for x in _fails[key] if t - x < 900]
        if len(_fails[key]) >= 5:
            return err("Too many failed logins. Try again in 15 minutes.", 429)
        resp = orig()
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        if status == 401:
            _fails[key].append(t)
        else:
            _fails.pop(key, None)
        return resp

    app.view_functions["login"] = guarded


def setup(app, db_connect, user_json):
    global _db
    _db = db_connect
    with db_connect() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        if "wallet_address" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN wallet_address TEXT")
        c.execute("UPDATE users SET wallet_address = '0x' || lower(hex(randomblob(20))) "
                  "WHERE wallet_address IS NULL")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet "
                  "ON users(wallet_address)")
        c.execute("""CREATE TRIGGER IF NOT EXISTS trg_user_wallet
            AFTER INSERT ON users WHEN NEW.wallet_address IS NULL
            BEGIN
                UPDATE users SET wallet_address = '0x' || lower(hex(randomblob(20)))
                WHERE id = NEW.id;
            END""")
        c.execute("""CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            tck_delta TEXT NOT NULL DEFAULT '0.00',
            ngn_delta TEXT NOT NULL DEFAULT '0.00',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id))""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, id)")
        c.execute("""CREATE TABLE IF NOT EXISTS stakes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            vault_days INTEGER NOT NULL,
            apy TEXT NOT NULL,
            amount TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            unlock_at INTEGER NOT NULL,
            last_claim_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            FOREIGN KEY(user_id) REFERENCES users(id))""")
        c.execute("""CREATE TABLE IF NOT EXISTS proposals (
            id INTEGER PRIMARY KEY,
            label TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open')""")
        c.execute("""CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            proposal_id INTEGER NOT NULL,
            choice TEXT NOT NULL CHECK(choice IN ('yes','no')),
            UNIQUE(user_id, proposal_id),
            FOREIGN KEY(user_id) REFERENCES users(id))""")
        c.execute("INSERT OR IGNORE INTO proposals (id, label, title, status) VALUES "
                  "(1, 'Proposal #104', 'Allocate 50,000 TCK to Lagos Micro-Merchant Terminals', 'open'), "
                  "(2, 'Proposal #103', 'Sponsor Abuja Web3 Developer Grants', 'passed')")

    app.register_blueprint(bp)
    guard_login(app)
    app.view_functions["home"] = lambda: redirect(
        "/dashboard" if session.get("user_id") else "/login")
