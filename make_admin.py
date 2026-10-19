import sqlite3
import sys

if len(sys.argv) != 2:
    print("Use: python make_admin.py email@example.com")
    sys.exit(1)

email = sys.argv[1].strip().lower()
c = sqlite3.connect("tck.db")
have = {r[1] for r in c.execute("PRAGMA table_info(users)")}
if "is_admin" not in have:
    c.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
cur = c.execute("UPDATE users SET is_admin = 1 WHERE email = ?", (email,))
c.commit()
print("Done, admin set." if cur.rowcount else "No user with that email.")
