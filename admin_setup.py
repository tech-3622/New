import re
from pathlib import Path

from werkzeug.security import generate_password_hash

ADMIN_EMAILS = ["mrcandlekuti@gmail.com"]

BASE_DIR = Path(__file__).resolve().parent
EMAIL_RE = re.compile(r"[^@\s'\"]+@[^@\s'\"]+\.[^@\s'\"]+")


def read_env():
    out = {}
    path = BASE_DIR / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def setup(app, db_connect):
    emails = [e.strip().lower() for e in ADMIN_EMAILS if EMAIL_RE.fullmatch(e.strip())]
    password = read_env().get("TCK_ADMIN_PASSWORD", "")
    marks = ", ".join("'" + e + "'" for e in emails) or "''"
    with db_connect() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(users)")}
        if "is_admin" not in cols:
            c.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        if emails and password:
            email = emails[0]
            row = c.execute("SELECT id FROM users WHERE lower(email) = ?", (email,)).fetchone()
            if row is None:
                base = re.sub(r"[^A-Za-z0-9_]", "", email.split("@")[0])[:24] or "admin"
                if len(base) < 3:
                    base = base + "_admin"
                name = base
                n = 1
                while c.execute("SELECT 1 FROM users WHERE username = ?", (name,)).fetchone():
                    n += 1
                    name = base + str(n)
                cur = c.execute(
                    "INSERT INTO users (username, email, password_hash, ngn_balance, tck_balance) "
                    "VALUES (?, ?, ?, '0.00', '0.00')",
                    (name, email, generate_password_hash(password)),
                )
                uid = cur.lastrowid
                if "full_name" in cols:
                    c.execute("UPDATE users SET full_name = 'Admin' WHERE id = ?", (uid,))
                if "email_verified" in cols:
                    c.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (uid,))
        c.execute("DROP TRIGGER IF EXISTS trg_admin_email")
        c.execute("UPDATE users SET is_admin = CASE WHEN lower(email) IN (" + marks + ") THEN 1 ELSE 0 END")
        c.execute(
            "CREATE TRIGGER trg_admin_email AFTER INSERT ON users WHEN lower(NEW.email) IN ("
            + marks + ") BEGIN UPDATE users SET is_admin = 1 WHERE id = NEW.id; END"
        )
