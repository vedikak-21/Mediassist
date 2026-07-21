import sqlite3
from datetime import datetime
from flask import g
from database import get_db


def create_chat(user_id, title):
    db = get_db()
    created_at = datetime.utcnow().isoformat()
    cursor = db.execute(
        "INSERT INTO chats (user_id, title, created_at) VALUES (?, ?, ?)",
        (user_id, title, created_at),
    )
    db.commit()
    return cursor.lastrowid


def create_message(chat_id, sender, message, created_at=None):
    db = get_db()
    if created_at is None:
        created_at = datetime.utcnow().isoformat()
    cursor = db.execute(
        "INSERT INTO messages (chat_id, sender, message, created_at) VALUES (?, ?, ?, ?)",
        (chat_id, sender, message, created_at),
    )
    db.commit()
    return cursor.lastrowid


def get_user_chats(user_id):
    db = get_db()
    chats = db.execute(
        """
        SELECT
            c.id,
            c.title,
            c.created_at,
            COALESCE(m.message, '') AS preview,
            m.sender AS last_sender,
            m.created_at AS last_message_at
        FROM chats c
        LEFT JOIN messages m ON m.id = (
            SELECT id FROM messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1
        )
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
        """,
        (user_id,),
    ).fetchall()
    return [dict(chat) for chat in chats]


def get_chat_messages(chat_id):
    db = get_db()
    messages = db.execute(
        "SELECT id, sender, message, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC",
        (chat_id,),
    ).fetchall()
    return [dict(msg) for msg in messages]


def get_chat_by_id(chat_id, user_id):
    db = get_db()
    chat = db.execute(
        "SELECT id, title, created_at FROM chats WHERE id = ? AND user_id = ?",
        (chat_id, user_id),
    ).fetchone()
    return dict(chat) if chat else None


def delete_chat(chat_id):
    db = get_db()
    db.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
    db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    db.commit()


def create_report(user_id, filename, filepath, report_type, analysis):
    db = get_db()
    upload_date = datetime.utcnow().isoformat()
    cursor = db.execute(
        "INSERT INTO reports (user_id, filename, filepath, report_type, analysis, upload_date) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, filename, filepath, report_type, analysis, upload_date),
    )
    db.commit()
    return cursor.lastrowid


def get_user_reports(user_id):
    db = get_db()
    reports = db.execute(
        """
        SELECT r.id, r.filename, r.filepath, r.report_type, r.analysis, r.upload_date,
               CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS favorite
        FROM reports r
        LEFT JOIN favorites f ON f.report_id = r.id AND f.user_id = ?
        WHERE r.user_id = ?
        ORDER BY r.upload_date DESC
        """,
        (user_id, user_id),
    ).fetchall()
    return [dict(report) for report in reports]


def delete_report(report_id):
    db = get_db()
    db.execute("DELETE FROM reports WHERE id = ?", (report_id,))
    db.commit()


def set_report_favorite(user_id, report_id, favorite=True):
    db = get_db()
    now = datetime.utcnow().isoformat()
    exists = db.execute("SELECT id FROM favorites WHERE user_id = ? AND report_id = ?", (user_id, report_id)).fetchone()
    if favorite:
        if not exists:
            cursor = db.execute("INSERT INTO favorites (user_id, report_id, created_at) VALUES (?, ?, ?)", (user_id, report_id, now))
            db.commit()
            return cursor.lastrowid
        return exists["id"]
    else:
        if exists:
            db.execute("DELETE FROM favorites WHERE id = ?", (exists["id"],))
            db.commit()
        return None


def get_latest_report(user_id):
    db = get_db()
    report = db.execute(
        "SELECT id, filename, filepath, report_type, analysis, upload_date FROM reports WHERE user_id = ? ORDER BY upload_date DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    return dict(report) if report else None


def create_dashboard_entry(user_id, health_score, heart_rate, blood_pressure, blood_sugar, hemoglobin):
    db = get_db()
    last_updated = datetime.utcnow().isoformat()
    cursor = db.execute(
        "INSERT INTO dashboard (user_id, health_score, heart_rate, blood_pressure, blood_sugar, hemoglobin, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, health_score, heart_rate, blood_pressure, blood_sugar, hemoglobin, last_updated),
    )
    db.commit()
    return cursor.lastrowid


def update_dashboard(user_id, health_score=None, heart_rate=None, blood_pressure=None, blood_sugar=None, hemoglobin=None):
    db = get_db()
    existing = db.execute("SELECT * FROM dashboard WHERE user_id = ?", (user_id,)).fetchone()
    if not existing:
        return create_dashboard_entry(user_id, health_score or 0, heart_rate or 0, blood_pressure or "0/0", blood_sugar or 0, hemoglobin or 0)

    data = {
        "health_score": health_score if health_score is not None else existing["health_score"],
        "heart_rate": heart_rate if heart_rate is not None else existing["heart_rate"],
        "blood_pressure": blood_pressure if blood_pressure is not None else existing["blood_pressure"],
        "blood_sugar": blood_sugar if blood_sugar is not None else existing["blood_sugar"],
        "hemoglobin": hemoglobin if hemoglobin is not None else existing["hemoglobin"],
    }
    last_updated = datetime.utcnow().isoformat()
    db.execute(
        "UPDATE dashboard SET health_score = ?, heart_rate = ?, blood_pressure = ?, blood_sugar = ?, hemoglobin = ?, last_updated = ? WHERE user_id = ?",
        (data["health_score"], data["heart_rate"], data["blood_pressure"], data["blood_sugar"], data["hemoglobin"], last_updated, user_id),
    )
    db.commit()
    return user_id


def get_dashboard_for_user(user_id):
    db = get_db()
    dashboard = db.execute(
        "SELECT id, health_score, heart_rate, blood_pressure, blood_sugar, hemoglobin, last_updated FROM dashboard WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return dict(dashboard) if dashboard else None


def get_user_summary(user_id):
    db = get_db()
    count_reports = db.execute("SELECT COUNT(*) AS count FROM reports WHERE user_id = ?", (user_id,)).fetchone()["count"]
    count_chats = db.execute("SELECT COUNT(*) AS count FROM chats WHERE user_id = ?", (user_id,)).fetchone()["count"]
    latest_report = get_latest_report(user_id)
    dashboard = get_dashboard_for_user(user_id)
    return {
        "reports_uploaded": count_reports,
        "chat_count": count_chats,
        "latest_report": latest_report,
        "dashboard": dashboard,
    }
