from datetime import timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, g
from google import genai
from dotenv import load_dotenv
import os

from auth import (
    create_user,
    get_user_by_email,
    get_user_by_id,
    login_required,
    save_profile_picture,
    update_user_profile,
    update_user_credentials,
    verify_password,
)
from database import close_db, get_db, init_db
from models import (
    create_chat,
    create_message,
    get_user_chats,
    get_chat_messages,
    delete_chat,
    create_report,
    get_user_reports,
    delete_report,
    get_latest_report,
    get_dashboard_for_user,
    update_dashboard,
    get_user_summary,
)

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change-this-secret")
app.permanent_session_lifetime = timedelta(days=30)

# Upload folder
UPLOAD_FOLDER = "uploads"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# Create uploads folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Gemini Client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
# No in-memory conversation history — using persistent storage (SQLite)

@app.teardown_appcontext
def teardown_db(exception=None):
    close_db(exception)

with app.app_context():
    init_db()

@app.before_request
def load_logged_in_user():
    user_id = session.get("user_id")
    if user_id is None:
        g.user = None
    else:
        g.user = get_user_by_id(user_id)

@app.context_processor
def inject_user():
    return {"user": g.user}


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        remember = request.form.get("remember") == "on"

        if not email or not password:
            return render_template("login.html", error="Email and password are required.")

        user = get_user_by_email(email)
        if user is None or not verify_password(user["password_hash"], password):
            return render_template("login.html", error="Invalid email or password.")

        session.clear()
        session["user_id"] = user["id"]
        session.permanent = remember

        next_page = request.args.get("next") or url_for("home")
        return redirect(next_page)

    return render_template("login.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")
        profile_picture = request.files.get("profile_picture")

        if not full_name or not email or not password or not confirm_password:
            return render_template("signup.html", error="All fields are required.")

        if password != confirm_password:
            return render_template("signup.html", error="Passwords do not match.")

        if get_user_by_email(email) is not None:
            return render_template("signup.html", error="An account with that email already exists.")

        picture_path = save_profile_picture(profile_picture) if profile_picture else None
        user_id = create_user(full_name, email, password, picture_path)

        session.clear()
        session["user_id"] = user_id
        session.permanent = True
        return redirect(url_for("home"))

    return render_template("signup.html")


@app.route("/profile", methods=["GET", "POST"])
@login_required
def profile():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")
        profile_picture = request.files.get("profile_picture")

        if not full_name or not email:
            return render_template("profile.html", error="Name and email are required.")

        existing = get_user_by_email(email)
        if existing and existing["id"] != g.user["id"]:
            return render_template("profile.html", error="That email is already in use.")

        picture_path = save_profile_picture(profile_picture) if profile_picture else g.user["profile_picture"]
        update_user_profile(g.user["id"], full_name, email, picture_path)

        if password:
            if password != confirm_password:
                return render_template("profile.html", error="Passwords do not match.")
            update_user_credentials(g.user["id"], password)

        return redirect(url_for("profile"))

    return render_template("profile.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home():
    print("Loading index.html...")
    return render_template("index.html")


# ---------------- CHAT ---------------- #

@app.route("/chat", methods=["POST"])
@login_required
def chat():
    try:
        data = request.get_json(silent=True) or {}
        user_message = data.get("message", "").strip()
        chat_id = data.get("chat_id")

        if not user_message:
            return jsonify({"reply": "❌ Please enter a message."}), 400

        # If no chat_id provided, create a new chat for this user
        if not chat_id:
            title = user_message if len(user_message) <= 80 else user_message[:77] + "..."
            chat_id = create_chat(g.user["id"], title)

        # Persist user message
        create_message(chat_id, "user", user_message)

        # Include latest report summary if available
        latest_report = get_latest_report(g.user["id"]) or {}
        last_report_analysis = latest_report.get("analysis", "")

        prompt = (
            "You are MediAssist AI, a helpful healthcare assistant.\n\n"
            "Previous Medical Report:\n\n"
            f"{last_report_analysis}\n\n"
            "Conversation:\n\n"
            f"User: {user_message}\n\n"
            "Answer the latest user question naturally.\n\n"
            "Rules:\n\n"
            "- Never diagnose.\n"
            "- Never prescribe medicines.\n"
            "- Explain simply.\n"
            "- Recommend consulting a doctor when necessary.\n"
            "- Use GitHub Markdown only.\n"
            "- Never use LaTeX.\n"
            "- Write units as plain text, for example: 14.5 g/dL, 118/76 mmHg, 92 mg/dL, 72 bpm.\n"
        )

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=prompt,
        )

        assistant_text = response.text

        # Persist assistant reply
        create_message(chat_id, "ai", assistant_text)

        return jsonify({"reply": assistant_text, "chat_id": chat_id})

    except Exception as e:
        print(e)
        return jsonify({"reply": str(e)}), 500


# ---------------- FILE UPLOAD ---------------- #

@app.route("/upload", methods=["POST"])
@login_required
def upload():
    try:
        if "report" not in request.files:
            return jsonify({"reply": "❌ No file uploaded."}), 400

        file = request.files["report"]
        if file.filename == "":
            return jsonify({"reply": "❌ Please select a file."}), 400

        # Ensure user-specific upload folder
        user_folder = os.path.join(app.config["UPLOAD_FOLDER"], f"user_{g.user['id']}")
        os.makedirs(user_folder, exist_ok=True)

        safe_name = file.filename.replace("..", "")
        filepath = os.path.join(user_folder, safe_name)
        file.save(filepath)

        # Upload to Gemini and analyze
        uploaded_file = client.files.upload(file=filepath)
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=[
                uploaded_file,
                """
You are MediAssist AI.

Analyze this medical report.

Explain:
1. What type of report it is.
2. Any abnormal values.
3. Explain everything in simple language.
4. Do not diagnose diseases.
5. Recommend consulting a doctor when needed.
""",
            ],
        )

        analysis = response.text

        # Persist report record
        report_type = "Unknown"
        report_id = create_report(g.user["id"], file.filename, filepath, report_type, analysis)

        # Ensure dashboard row exists (no-op if already present)
        try:
            update_dashboard(g.user["id"]) 
        except Exception:
            pass

        return jsonify({"reply": analysis, "report_id": report_id, "filename": file.filename, "filepath": filepath})

    except Exception as e:
        print(e)
        return jsonify({"reply": str(e)}), 500


@app.route("/api/reports", methods=["GET"])
@login_required
def api_get_reports():
    reports = get_user_reports(g.user["id"])
    return jsonify({"reports": reports})


@app.route("/api/reports/<int:report_id>", methods=["DELETE"])
@login_required
def api_delete_report(report_id):
    # Validate ownership
    db = get_db()
    rpt = db.execute("SELECT * FROM reports WHERE id = ? AND user_id = ?", (report_id, g.user["id"])).fetchone()
    if not rpt:
        return jsonify({"error": "Report not found"}), 404
    # Remove file
    try:
        if rpt["filepath"] and os.path.exists(rpt["filepath"]):
            os.remove(rpt["filepath"])
    except Exception:
        pass
    delete_report(report_id)
    return jsonify({"success": True})


@app.route("/api/reports/<int:report_id>/favorite", methods=["POST"])
@login_required
def api_favorite_report(report_id):
    data = request.get_json(silent=True) or {}
    fav = data.get("favorite")
    if fav is None:
        return jsonify({"error": "favorite=true|false required"}), 400
    try:
        fav_bool = bool(fav)
        from models import set_report_favorite

        set_report_favorite(g.user["id"], report_id, fav_bool)
        return jsonify({"success": True, "favorite": fav_bool})
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/chats", methods=["GET", "POST"])
@login_required
def api_chats():
    if request.method == "GET":
        chats = get_user_chats(g.user["id"])
        return jsonify({"chats": chats})

    # POST -> create chat
    data = request.get_json(silent=True) or {}
    title = data.get("title", "New conversation")
    chat_id = create_chat(g.user["id"], title)
    return jsonify({"chat_id": chat_id})


@app.route("/api/chats/<int:chat_id>/messages", methods=["GET", "POST"])
@login_required
def api_chat_messages(chat_id):
    # Ensure chat belongs to user
    chat = get_db().execute("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, g.user["id"])).fetchone()
    if not chat:
        return jsonify({"error": "Chat not found"}), 404

    if request.method == "GET":
        msgs = get_chat_messages(chat_id)
        return jsonify({"messages": msgs})

    data = request.get_json(silent=True) or {}
    sender = data.get("sender", "user")
    message = data.get("message", "")
    if not message:
        return jsonify({"error": "Message is required"}), 400
    mid = create_message(chat_id, sender, message)
    return jsonify({"message_id": mid})


@app.route("/api/dashboard", methods=["GET"])
@login_required
def api_dashboard():
    dashboard = get_dashboard_for_user(g.user["id"]) or {}
    summary = get_user_summary(g.user["id"]) or {}
    return jsonify({"dashboard": dashboard, "summary": summary})


@app.route("/api/reports/<int:report_id>/download", methods=["GET"])
@login_required
def api_download_report(report_id):
    db = get_db()
    rpt = db.execute("SELECT * FROM reports WHERE id = ? AND user_id = ?", (report_id, g.user["id"])).fetchone()
    if not rpt:
        return jsonify({"error": "Report not found"}), 404
    filepath = rpt["filepath"]
    if not filepath or not os.path.exists(filepath):
        return jsonify({"error": "File missing"}), 404
    from flask import send_file

    return send_file(filepath, as_attachment=True, download_name=rpt["filename"])


if __name__ == "__main__":
    app.run(debug=True)