from flask import Blueprint, render_template, session

bp = Blueprint("about", __name__)


@bp.get("/about")
def about_page():
    return render_template("about.html", logged_in=bool(session.get("user_id")))


def setup(app):
    app.register_blueprint(bp)
