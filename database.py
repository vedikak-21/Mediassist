import sqlite3
from pathlib import Path
from flask import g

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "mediassist.db"


def get_db():
    """Return a SQLite connection tied to the current Flask request context."""
    db = g.get("_database")
    if db is None:
        db = sqlite3.connect(
            DATABASE_PATH,
            detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES,
            check_same_thread=False,
        )
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        g._database = db
    return db


def close_db(e=None):
    """Close the database connection at the end of the request."""
    db = g.pop("_database", None)
    if db is not None:
        db.close()


def init_db():
    """Create application tables if they do not exist."""
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            profile_picture TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            report_type TEXT,
            analysis TEXT,
            upload_date TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            report_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (report_id) REFERENCES reports (id) ON DELETE CASCADE,
            UNIQUE(user_id, report_id)
        );

        CREATE TABLE IF NOT EXISTS dashboard (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            health_score INTEGER NOT NULL DEFAULT 0,
            heart_rate INTEGER NOT NULL DEFAULT 0,
            blood_pressure TEXT NOT NULL DEFAULT '0/0',
            blood_sugar INTEGER NOT NULL DEFAULT 0,
            hemoglobin INTEGER NOT NULL DEFAULT 0,
            last_updated TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()
