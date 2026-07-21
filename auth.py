import os
import re
from datetime import datetime
from functools import wraps
from pathlib import Path
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from flask import session, redirect, url_for, request, jsonify, g
from database import get_db

BASE_DIR = Path(__file__).resolve().parent
PROFILE_UPLOAD_DIR = BASE_DIR / "static" / "uploads" / "profiles"
PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif"}


def is_valid_email(email):
    return bool(re.match(r"^[\w\.-]+@[\w\.-]+\.\w+$", email.strip()))


def get_user_by_email(email):
    db = get_db()
    return db.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()


def get_user_by_id(user_id):
    db = get_db()
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create_user(full_name, email, password, profile_picture=None):
    db = get_db()
    password_hash = generate_password_hash(password)
    created_at = datetime.utcnow().isoformat()
    cursor = db.execute(
        "INSERT INTO users (full_name, email, password_hash, profile_picture, created_at) VALUES (?, ?, ?, ?, ?)",
        (full_name.strip(), email.strip().lower(), password_hash, profile_picture, created_at),
    )
    db.commit()
    return cursor.lastrowid


def update_user_profile(user_id, full_name, email, profile_picture=None):
    db = get_db()
    if profile_picture:
        db.execute(
            "UPDATE users SET full_name = ?, email = ?, profile_picture = ? WHERE id = ?",
            (full_name.strip(), email.strip().lower(), profile_picture, user_id),
        )
    else:
        db.execute(
            "UPDATE users SET full_name = ?, email = ? WHERE id = ?",
            (full_name.strip(), email.strip().lower(), user_id),
        )
    db.commit()


def update_user_credentials(user_id, password):
    db = get_db()
    password_hash = generate_password_hash(password)
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    db.commit()


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_profile_picture(file_storage):
    if not file_storage or not allowed_file(file_storage.filename):
        return None
    filename = secure_filename(file_storage.filename)
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_name = f"{timestamp}_{filename}"
    destination = PROFILE_UPLOAD_DIR / safe_name
    file_storage.save(destination)
    return f"uploads/profiles/{safe_name}"


def verify_password(stored_hash, password):
    return check_password_hash(stored_hash, password)


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            if request.path.startswith("/chat") or request.path.startswith("/upload") or request.is_json:
                return jsonify({"error": "Authentication required."}), 401
            return redirect(url_for("login", next=request.path))

        user = get_user_by_id(user_id)
        if user is None:
            session.clear()
            return redirect(url_for("login"))

        g.user = user
        return view(*args, **kwargs)

    return wrapped_view
