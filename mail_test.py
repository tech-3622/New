import os
import re
import secrets
import smtplib
import time
from email.message import EmailMessage
from threading import Lock
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024

# This test tool must remain local to your phone.
HOST = "127.0.0.1"
PORT = 5001

# Basic in-memory rate limit for testing.
send_lock = Lock()
last_sent = {}


def valid_email(address):
    return (
        isinstance(address, str)
        and len(address) <= 254
        and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", address) is not None
    )


@app.get("/")
def home():
    return render_template("email_test.html")


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "TCK Email Test"})


@app.post("/send-test")
def send_test():
    data = request.get_json(silent=True) or {}

    sender = str(data.get("sender", "")).strip()
    password = data.get("app_password", "")
    recipient = str(data.get("recipient", "")).strip()

    if not valid_email(sender) or not valid_email(recipient):
        return jsonify({
            "ok": False,
            "error": "Enter valid sender and receiving email addresses."
        }), 400

    if not isinstance(password, str) or not password.strip():
        return jsonify({
            "ok": False,
            "error": "Enter your email App Password."
        }), 400

    if len(password) > 256 or "\n" in password or "\r" in password:
        return jsonify({
            "ok": False,
            "error": "The App Password format is invalid."
        }), 400

    # Limit attempts per recipient; do not store email credentials.
    now = time.time()
    with send_lock:
        previous = last_sent.get(recipient.lower(), 0)
        if now - previous < 30:
            wait = max(1, int(30 - (now - previous)))
            return jsonify({
                "ok": False,
                "error": f"Please wait {wait} seconds before trying again."
            }), 429
        last_sent[recipient.lower()] = now

    # Leading zeros are allowed, e.g. 0047.
    code = f"{secrets.randbelow(10000):04d}"

    message = EmailMessage()
    message["Subject"] = "Your TCK Token verification code"
    message["From"] = f"TCK Token <{sender}>"
    message["To"] = recipient
    message.set_content(
        "Hello,\n\n"
        "You requested to verify your email address for TCK Token.\n\n"
        f"Your verification code is: {code}\n\n"
        "Enter this code on the TCK Token website to continue. "
        "For your security, do not share this code with anyone.\n\n"
        "If you did not request this code, you can ignore this email.\n\n"
        "Regards,\n"
        "TCK Token Team"
    )

    try:
        # Gmail SMTP with encrypted connection.
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
            smtp.login(sender, password.strip())
            smtp.send_message(message)

        return jsonify({
            "ok": True,
            "message": "Email accepted by the SMTP server. Check the recipient inbox and spam folder.",
            "recipient": recipient
        })

    except smtplib.SMTPAuthenticationError:
        return jsonify({
            "ok": False,
            "error": "Email login failed. Check the sender address and Gmail App Password."
        }), 401

    except (smtplib.SMTPException, OSError) as exc:
        app.logger.warning("Email delivery test failed: %s", type(exc).__name__)
        return jsonify({
            "ok": False,
            "error": "Email could not be sent. Check your internet connection, Gmail settings and App Password."
        }), 502

    finally:
        # Never retain the submitted password in application state.
        password = None


if __name__ == "__main__":
    print(f"TCK email test running at http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
