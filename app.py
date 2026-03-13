import os
import tempfile
import base64
import requests
import uuid
import time
import hashlib
import secrets
import re
import subprocess
import mimetypes
import json
from flask import Flask, render_template, request, jsonify, Response
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB max
app.config["UPLOAD_FOLDER"] = tempfile.gettempdir()
app.config["JSON_AS_ASCII"] = False  # Preserve unicode (umlauts etc.)

# In-memory stores
job_store = {}
pow_store = {}

# Config
PORT = int(os.getenv("PORT", "5000"))
DEBUG = os.getenv("FLASK_ENV", "development") == "development"

# Proof-of-Work config
POW_EXPIRES_SECONDS = 300
POW_DIFFICULTY = 4

# API config
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "google/gemini-3-flash-preview"

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MAX_FILE_SIZE = 24 * 1024 * 1024  # 24MB

# Constants
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
SUPPORTED_EXTENSIONS = {
    "mp3", "wav", "ogg", "m4a", "mp4", "aac", "webm", "wma", "aiff", "flac", "mov", "mkv",
}
SUPPORTED_MIMETYPES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/ogg",
    "audio/x-m4a", "audio/mp4", "audio/aac", "audio/x-wav", "audio/webm",
    "audio/x-ms-wma", "audio/x-aiff", "audio/flac",
    "video/webm", "video/mp4", "video/quicktime", "video/x-matroska",
}
# Audio format mapping for OpenRouter
AUDIO_FORMAT_MAP = {
    "ogg": "ogg", "mp3": "mp3", "wav": "wav", "m4a": "mp4",
    "mp4": "mp4", "aac": "aac", "flac": "flac", "webm": "webm",
}


# --- Helpers ---

def generate_job_id():
    return str(uuid.uuid4())

def generate_pow_id():
    return str(uuid.uuid4())

def generate_challenge():
    return secrets.token_hex(16)

def verify_pow(challenge, nonce, difficulty):
    hash_input = f"{challenge}{nonce}".encode("utf-8")
    hash_result = hashlib.sha256(hash_input).hexdigest()
    return hash_result.startswith("0" * difficulty)

def cleanup_expired_pow():
    current_time = time.time()
    expired = [pid for pid, d in pow_store.items() if d["expires"] > 0 and d["expires"] < current_time]
    for pid in expired:
        del pow_store[pid]

def save_job_data(job_id, key, value):
    job_store.setdefault(job_id, {})[key] = value

def get_job_data(job_id, key):
    return job_store.get(job_id, {}).get(key)

def cleanup_job(job_id):
    data = job_store.pop(job_id, {})
    for k in ["file_path", "converted_path", "compressed_path"]:
        p = data.get(k)
        if p and os.path.exists(p):
            os.unlink(p)

def allowed_file(filename, content_type=None):
    ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
    if ext in SUPPORTED_EXTENSIONS:
        return True
    norm_ct = (content_type or "").split(";")[0].strip().lower()
    if norm_ct in SUPPORTED_MIMETYPES:
        return True
    mime, _ = mimetypes.guess_type(filename or "")
    return mime in SUPPORTED_MIMETYPES

def remove_think_tags(text: str) -> str:
    if not text:
        return text
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"\n\s*\n\s*\n", "\n\n", cleaned)
    return cleaned.strip()


def convert_to_supported_audio(file_path: str) -> str:
    """Convert video/unsupported formats to ogg audio for Gemini."""
    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    if ext in AUDIO_FORMAT_MAP:
        return file_path
    # Convert to ogg opus
    output_path = os.path.splitext(file_path)[0] + ".ogg"
    try:
        subprocess.run(
            ["ffmpeg", "-i", file_path, "-vn", "-c:a", "libopus", "-b:a", "64k", "-y", output_path],
            capture_output=True, text=True, timeout=300, check=True,
        )
        return output_path
    except subprocess.CalledProcessError as e:
        raise ValueError(f"FFmpeg conversion failed: {e.stderr}")


def compress_audio(file_path: str, max_size: int = 24 * 1024 * 1024) -> str:
    """Compress audio to under max_size."""
    if os.path.getsize(file_path) <= max_size:
        return file_path
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", file_path],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(result.stdout.strip())
    except Exception as e:
        raise ValueError(f"Failed to get audio duration: {e}")

    target_kbps = max(16, min(128, int((max_size * 8) / duration) // 1000))
    output_path = os.path.splitext(file_path)[0] + "_compressed.ogg"
    subprocess.run(
        ["ffmpeg", "-i", file_path, "-vn", "-c:a", "libopus", "-b:a", f"{target_kbps}k", "-y", output_path],
        capture_output=True, text=True, timeout=300, check=True,
    )
    return output_path


# --- Groq Whisper transcription ---

def compress_audio_for_groq(file_path: str) -> str:
    """Compress audio to under 24MB for Groq Whisper API."""
    if os.path.getsize(file_path) <= GROQ_MAX_FILE_SIZE:
        return file_path
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", file_path],
            capture_output=True, text=True, timeout=30,
        )
        duration = float(result.stdout.strip())
    except Exception as e:
        raise ValueError(f"Failed to get audio duration: {e}")
    target_kbps = max(16, min(128, int((GROQ_MAX_FILE_SIZE * 8) / duration) // 1000))
    output_path = os.path.splitext(file_path)[0] + "_groq.ogg"
    subprocess.run(
        ["ffmpeg", "-i", file_path, "-vn", "-c:a", "libopus", "-b:a", f"{target_kbps}k", "-y", output_path],
        capture_output=True, text=True, timeout=300, check=True,
    )
    return output_path


def transcribe_with_groq(file_path: str) -> str:
    """Transcribe audio using Groq Whisper large-v3."""
    compressed = compress_audio_for_groq(file_path)
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    with open(compressed, "rb") as f:
        files = {"file": (os.path.basename(compressed), f, "application/octet-stream")}
        data = {"model": "whisper-large-v3", "response_format": "text", "temperature": 0.0}
        response = requests.post(GROQ_API_URL, headers=headers, files=files, data=data, timeout=120)
    if compressed != file_path and os.path.exists(compressed):
        os.unlink(compressed)
    if response.status_code != 200:
        raise Exception(f"Groq Whisper failed ({response.status_code}): {response.text}")
    return response.text.strip()


# --- Gemini API calls via OpenRouter ---

def call_gemini_with_audio(file_path: str, prompt: str) -> str:
    """Send audio directly to Gemini Flash Lite via OpenRouter."""
    with open(file_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    audio_format = AUDIO_FORMAT_MAP.get(ext, "ogg")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": audio_format}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    }
    response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=120)
    if response.status_code != 200:
        raise Exception(f"OpenRouter API failed ({response.status_code}): {response.text}")
    return remove_think_tags(response.json()["choices"][0]["message"]["content"])


def call_gemini_text(system_prompt: str, user_prompt: str) -> str:
    """Text-only call to Gemini Flash Lite via OpenRouter."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=60)
    if response.status_code != 200:
        raise Exception(f"OpenRouter API failed ({response.status_code}): {response.text}")
    return remove_think_tags(response.json()["choices"][0]["message"]["content"])


# --- Routes ---

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/generate-pow", methods=["POST"])
def generate_pow():
    try:
        cleanup_expired_pow()
        challenge = generate_challenge()
        pow_id = generate_pow_id()
        pow_store[pow_id] = {
            "challenge": challenge,
            "difficulty": POW_DIFFICULTY,
            "expires": time.time() + POW_EXPIRES_SECONDS,
            "solved": False,
        }
        return jsonify({"success": True, "pow_id": pow_id, "challenge": challenge, "difficulty": POW_DIFFICULTY})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/validate-pow", methods=["POST"])
def validate_pow():
    try:
        data = request.get_json()
        pow_id = data.get("pow_id")
        nonce = data.get("nonce")

        if not pow_id or nonce is None:
            return jsonify({"success": False, "error": "Missing pow_id or nonce"}), 400

        cleanup_expired_pow()

        if pow_id not in pow_store:
            return jsonify({"success": False, "error": "Invalid or expired PoW challenge"}), 400

        pow_data = pow_store[pow_id]

        if pow_data["expires"] > 0 and time.time() > pow_data["expires"]:
            del pow_store[pow_id]
            return jsonify({"success": False, "error": "PoW challenge has expired"}), 400

        if pow_data.get("solved", False):
            return jsonify({"success": True, "valid": True})

        nonce = str(nonce)
        if verify_pow(pow_data["challenge"], nonce, pow_data["difficulty"]):
            pow_store[pow_id]["solved"] = True
            pow_store[pow_id]["expires"] = 0
            pow_store[pow_id]["validated_at"] = time.time()
            return jsonify({"success": True, "valid": True})
        else:
            return jsonify({"success": True, "valid": False})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process-audio", methods=["POST"])
def process_audio():
    # PoW validation
    pow_id = request.form.get("pow_id")
    if not pow_id:
        return jsonify({"error": "Proof-of-work validation required"}), 400

    cleanup_expired_pow()

    if pow_id not in pow_store:
        return jsonify({"error": "Invalid or expired PoW challenge"}), 400

    pow_data = pow_store[pow_id]
    if pow_data["expires"] != 0 or not pow_data.get("solved", False):
        return jsonify({"error": "PoW challenge not solved"}), 400

    validated_at = pow_data.get("validated_at", 0)
    if time.time() - validated_at > 300:
        del pow_store[pow_id]
        return jsonify({"error": "PoW validation expired"}), 400

    del pow_store[pow_id]

    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if not allowed_file(file.filename, file.content_type):
        return jsonify({"error": "Unsupported audio format"}), 400

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    if file_size > MAX_FILE_SIZE:
        return jsonify({"error": "File too large. Maximum size is 100MB."}), 400

    job_id = generate_job_id()
    filename = secure_filename(file.filename)
    upload_dir = app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)

    original_file_path = os.path.join(upload_dir, f"{job_id}_{filename}")
    file.save(original_file_path)

    save_job_data(job_id, "original_filename", filename)
    save_job_data(job_id, "file_path", original_file_path)

    processed_file_path = original_file_path

    try:
        # Convert if needed (video → audio)
        converted = convert_to_supported_audio(original_file_path)
        if converted != original_file_path:
            save_job_data(job_id, "converted_path", converted)
            processed_file_path = converted

        # Compress if too large
        compressed = compress_audio(processed_file_path)
        if compressed != processed_file_path:
            save_job_data(job_id, "compressed_path", compressed)
            processed_file_path = compressed

        save_job_data(job_id, "processed_file_path", processed_file_path)

        return jsonify({
            "message": "File uploaded and preprocessed successfully.",
            "job_id": job_id,
            "filename": filename,
        }), 200
    except Exception as e:
        cleanup_job(job_id)
        return jsonify({"error": str(e)}), 500


@app.route("/transcribe", methods=["POST"])
def transcribe_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")

    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400

    file_path = get_job_data(job_id, "processed_file_path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "File not found. Please upload again."}), 404

    try:
        # Transcribe audio directly via Gemini
        transcription = call_gemini_with_audio(
            file_path,
            "Transcribe this audio accurately. Return ONLY the transcription text, nothing else. "
            "Use the same language as the audio.",
        )
        save_job_data(job_id, "original_transcription", transcription)
        return jsonify({"job_id": job_id, "original_transcription": transcription}), 200
    except Exception as e:
        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500


@app.route("/improve", methods=["POST"])
def improve_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")
    transcription = data.get("transcription") or get_job_data(job_id, "original_transcription")

    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400
    if not transcription:
        return jsonify({"error": "Transcription not found"}), 404

    try:
        improved = call_gemini_text(
            "You are a helpful assistant that improves transcriptions.",
            f"Improve this transcription: fix grammar, spelling, punctuation. "
            f"Improve readability while maintaining original meaning. "
            f"Return ONLY the improved text.\n\n{transcription}",
        )
        save_job_data(job_id, "improved_transcription", improved)
        return jsonify({"job_id": job_id, "improved_transcription": improved}), 200
    except Exception as e:
        return jsonify({"error": f"Improvement failed: {str(e)}"}), 500


@app.route("/summarize", methods=["POST"])
def summarize_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")
    transcription = data.get("transcription") or get_job_data(job_id, "improved_transcription")

    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400
    if not transcription:
        return jsonify({"error": "Transcription not found"}), 404

    try:
        summary = call_gemini_text(
            "You are a helpful assistant that summarizes transcriptions.",
            f"Summarize this transcription using bullet points. "
            f"Write from the perspective of the transcript. Use the same language. "
            f"ONLY RETURN THE SUMMARY.\n\n{transcription}",
        )
        save_job_data(job_id, "summary", summary)
        return jsonify({"job_id": job_id, "summary": summary}), 200
    except Exception as e:
        return jsonify({"error": f"Summarization failed: {str(e)}"}), 500


def stream_gemini_with_audio(file_path: str, prompt: str):
    """Stream audio transcription from Gemini via OpenRouter."""
    with open(file_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    ext = os.path.splitext(file_path)[1].lower().lstrip(".")
    audio_format = AUDIO_FORMAT_MAP.get(ext, "ogg")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "stream": True,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": audio_format}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    }
    response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=120, stream=True)
    if response.status_code != 200:
        raise Exception(f"OpenRouter API failed ({response.status_code}): {response.text}")
    return response


def stream_gemini_text(system_prompt: str, user_prompt: str):
    """Stream text completion from Gemini via OpenRouter."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=60, stream=True)
    if response.status_code != 200:
        raise Exception(f"OpenRouter API failed ({response.status_code}): {response.text}")
    return response


def iter_sse_tokens(response):
    """Iterate over SSE tokens from an OpenRouter streaming response."""
    for line in response.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data_str = line[6:]
        if data_str.strip() == "[DONE]":
            break
        try:
            chunk = json.loads(data_str)
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            token = delta.get("content")
            if token:
                yield token
        except (json.JSONDecodeError, IndexError, KeyError):
            continue


@app.route("/stream/<job_id>")
def stream_endpoint(job_id):
    if job_id not in job_store:
        return jsonify({"error": "Job not found"}), 404

    file_path = get_job_data(job_id, "processed_file_path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    def generate():
        try:
            # --- Transcription (Groq Whisper) ---
            transcription_text = transcribe_with_groq(file_path)
            save_job_data(job_id, "original_transcription", transcription_text)
            # Stream transcription token by token (word chunks)
            words = transcription_text.split(" ")
            for i, word in enumerate(words):
                token = (word + " ") if i < len(words) - 1 else word
                yield f"data: {json.dumps({'section': 'transcription', 'token': token}, ensure_ascii=False)}\n\n"

            # --- Improvement ---
            resp = stream_gemini_text(
                "You are a helpful assistant that improves transcriptions.",
                f"Improve this transcription: fix grammar, spelling, punctuation. "
                f"Improve readability while maintaining original meaning. "
                f"Return ONLY the improved text.\n\n{transcription_text}",
            )
            full_improved = []
            for token in iter_sse_tokens(resp):
                full_improved.append(token)
                yield f"data: {json.dumps({'section': 'improved', 'token': token}, ensure_ascii=False)}\n\n"
            improved_text = remove_think_tags("".join(full_improved))
            save_job_data(job_id, "improved_transcription", improved_text)

            # --- Summary ---
            resp = stream_gemini_text(
                "You are a helpful assistant that summarizes transcriptions.",
                f"Summarize this transcription using bullet points. "
                f"Write from the perspective of the transcript. Use the same language. "
                f"ONLY RETURN THE SUMMARY.\n\n{improved_text}",
            )
            full_summary = []
            for token in iter_sse_tokens(resp):
                full_summary.append(token)
                yield f"data: {json.dumps({'section': 'summary', 'token': token}, ensure_ascii=False)}\n\n"
            summary_text = remove_think_tags("".join(full_summary))
            save_job_data(job_id, "summary", summary_text)

            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/cleanup/<job_id>", methods=["DELETE"])
def cleanup_endpoint(job_id):
    if not job_id or job_id not in job_store:
        return jsonify({"error": "Job ID not found"}), 404
    cleanup_job(job_id)
    return jsonify({"message": f"Cleaned up job {job_id}"}), 200


if __name__ == "__main__":
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not set")

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    app.run(debug=DEBUG, port=PORT, host="0.0.0.0")
