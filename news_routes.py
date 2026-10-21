from functools import wraps

from flask import Blueprint, jsonify, request, session

LABELS = ("update", "maintenance", "community", "important")

bp = Blueprint("news", __name__)
_db = None


def err(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def login_needed(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return err("Please log in first.", 401)
        return fn(*args, **kwargs)
    return wrapper


def admin_needed(fn):
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


def read_post():
    d = request.get_json(silent=True) or {}
    title = " ".join(str(d.get("title", "")).split())
    body = str(d.get("body", "")).replace("\r", "").strip()
    label = str(d.get("label", "update")).lower()
    if not 3 <= len(title) <= 120:
        return None, "Title must be 3-120 characters."
    if not 1 <= len(body) <= 2000:
        return None, "Message must be 1-2000 characters."
    if label not in LABELS:
        return None, "Choose a label."
    pinned = 1 if d.get("pinned") else 0
    urgent = 1 if d.get("urgent") else 0
    return (title, body, label, pinned, urgent), None


def all_posts():
    with _db() as c:
        rows = c.execute(
            "SELECT id, title, body, label, pinned, urgent, created_at, updated_at "
            "FROM news ORDER BY pinned DESC, id DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


@bp.get("/api/news")
@login_needed
def member_news():
    return jsonify({"ok": True, "news": all_posts()})


@bp.get("/api/admin/news")
@admin_needed
def admin_news():
    return jsonify({"ok": True, "news": all_posts()})


@bp.post("/api/admin/news")
@admin_needed
def news_create():
    vals, problem = read_post()
    if problem:
        return err(problem)
    with _db() as c:
        c.execute(
            "INSERT INTO news (title, body, label, pinned, urgent) VALUES (?, ?, ?, ?, ?)",
            vals,
        )
    return jsonify({"ok": True, "message": "News posted."}), 201


@bp.post("/api/admin/news/<int:nid>/update")
@admin_needed
def news_update(nid):
    vals, problem = read_post()
    if problem:
        return err(problem)
    with _db() as c:
        cur = c.execute(
            "UPDATE news SET title = ?, body = ?, label = ?, pinned = ?, urgent = ?, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            vals + (nid,),
        )
    if cur.rowcount == 0:
        return err("Post not found.", 404)
    return jsonify({"ok": True, "message": "Saved."})


@bp.post("/api/admin/news/<int:nid>/delete")
@admin_needed
def news_delete(nid):
    with _db() as c:
        cur = c.execute("DELETE FROM news WHERE id = ?", (nid,))
    if cur.rowcount == 0:
        return err("Post not found.", 404)
    return jsonify({"ok": True, "message": "Deleted."})


def setup(app, db_connect):
    global _db
    _db = db_connect
    with db_connect() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT 'update',
            pinned INTEGER NOT NULL DEFAULT 0,
            urgent INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT)""")
    app.register_blueprint(bp)
