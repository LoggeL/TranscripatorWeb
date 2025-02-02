import os
import tempfile
import requests
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    stream_with_context,
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from pydub import AudioSegment
import mimetypes
import json

# Load environment variables from .env file
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25MB max file size
app.config["UPLOAD_FOLDER"] = tempfile.gettempdir()

# Configuration
PORT = int(os.getenv("PORT", "5000"))
DEBUG = os.getenv("FLASK_ENV", "development") == "development"

# Groq API configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1"
GROQ_HEADERS = {
    "Authorization": f"Bearer {GROQ_API_KEY}",
    "Content-Type": "application/json",
}

# Turnstile configuration
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY")
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY")

# Constants
ALLOWED_EXTENSIONS = {"mp3", "wav", "ogg", "m4a"}
SUPPORTED_MIMETYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/ogg",
    "audio/x-m4a",
    "audio/mp4",
    "audio/aac",
    "audio/x-wav",
    "audio/webm",
    "audio/x-ms-wma",
    "audio/x-aiff",
    "audio/flac",
}


def get_audio_format(file_path: str) -> str:
    """Get the audio format from the file path."""
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type in SUPPORTED_MIMETYPES:
        return mime_type.split("/")[-1]
    return None


def convert_audio(input_path: str, target_format: str = "wav") -> str:
    """Convert audio file to a supported format."""
    try:
        # Determine the input format
        input_format = get_audio_format(input_path)
        if not input_format:
            raise ValueError("Unsupported audio format")

        # Load the audio file
        if input_format == "mp3":
            audio = AudioSegment.from_mp3(input_path)
        elif input_format == "wav":
            audio = AudioSegment.from_wav(input_path)
        elif input_format == "ogg":
            audio = AudioSegment.from_ogg(input_path)
        elif input_format in ["m4a", "mp4", "aac"]:
            audio = AudioSegment.from_file(input_path, format="m4a")
        elif input_format == "wma":
            audio = AudioSegment.from_file(input_path, format="wma")
        elif input_format == "flac":
            audio = AudioSegment.from_file(input_path, format="flac")
        elif input_format == "aiff":
            audio = AudioSegment.from_file(input_path, format="aiff")
        else:
            audio = AudioSegment.from_file(input_path)

        # Create output path
        output_path = os.path.splitext(input_path)[0] + f".{target_format}"

        # Export to target format
        audio.export(output_path, format=target_format)
        return output_path
    except Exception as e:
        raise ValueError(f"Error converting audio: {str(e)}")


def allowed_file(filename):
    """Check if the file type is allowed for processing."""
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type in SUPPORTED_MIMETYPES


def transcribe_audio(file_path: str) -> str:
    """Transcribe the audio file using Groq's API."""
    # Convert to WAV if not in a supported format
    original_ext = os.path.splitext(file_path)[1].lower()[1:]
    if original_ext not in ALLOWED_EXTENSIONS:
        try:
            converted_path = convert_audio(file_path, "wav")
            if os.path.exists(file_path):
                os.unlink(file_path)
            file_path = converted_path
        except Exception as e:
            raise ValueError(f"Error converting audio format: {str(e)}")

    with open(file_path, "rb") as file:
        files = {"file": (file_path, file, "audio/wav")}
        data = {
            "model": "whisper-large-v3-turbo",
            "temperature": 0,
            "response_format": "json",
            "language": "en",
        }
        response = requests.post(
            f"{GROQ_API_URL}/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files=files,
            data=data,
        )
        response.raise_for_status()
        return response.json()["text"]


def improve_transcription(transcription: str) -> str:
    """Improve the transcription using Groq's language model."""
    prompt = f"""
    Task: Improve the following transcription
    Instructions:
    1. Fix any grammatical or spelling errors
    2. Improve readability and coherence
    3. Maintain the original meaning and context
    4. Use appropriate punctuation and formatting
    5. Only return the improved text without any additional comments

    Original transcription:
    {transcription}

    Improved transcription:
    """

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }

    response = requests.post(
        f"{GROQ_API_URL}/chat/completions", headers=GROQ_HEADERS, json=payload
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def generate_summary(transcription: str) -> str:
    """Generate a summary of the transcription using Groq's language model."""
    prompt = f"""
    Task: Summarize the following transcription
    Instructions:
    1. Provide a concise summary of the main points
    2. Use bullet points for clarity
    3. Write from the perspective of the transcript
    4. Capture the key ideas and any important details
    5. Ensure the summary is coherent and easy to understand

    Transcription:
    {transcription}

    Summary:
    """

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.5,
    }

    response = requests.post(
        f"{GROQ_API_URL}/chat/completions", headers=GROQ_HEADERS, json=payload
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def verify_turnstile(token):
    """Verify Turnstile token with Cloudflare."""
    response = requests.post(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data={
            "secret": TURNSTILE_SECRET_KEY,
            "response": token,
        },
    )
    return response.json()["success"]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/process-audio", methods=["POST"])
def process_audio():
    # Verify Turnstile first
    token = request.form.get("cf-turnstile-response")
    if not token or not verify_turnstile(token):
        return jsonify({"error": "CAPTCHA verification failed"}), 400

    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported audio format"}), 400

    temp_path = None
    try:
        # Save the file temporarily
        filename = secure_filename(file.filename)
        temp_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(temp_path)

        def generate():
            try:
                # First yield the transcription
                transcription = transcribe_audio(temp_path)
                yield json.dumps(
                    {"type": "transcription", "data": transcription}
                ) + "\n"

                # Then yield the improved transcription
                improved = improve_transcription(transcription)
                yield json.dumps(
                    {"type": "improved_transcription", "data": improved}
                ) + "\n"

                # Finally yield the summary
                summary = generate_summary(improved)
                yield json.dumps({"type": "summary", "data": summary}) + "\n"

            except Exception as e:
                yield json.dumps({"type": "error", "data": str(e)}) + "\n"
            finally:
                # Clean up temporary files
                if temp_path and os.path.exists(temp_path):
                    os.unlink(temp_path)
                converted_path = os.path.splitext(temp_path)[0] + ".wav"
                if os.path.exists(converted_path):
                    os.unlink(converted_path)

        return Response(stream_with_context(generate()), mimetype="text/event-stream")

    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
        return jsonify({"error": str(e)}), 500


@app.route("/site-key")
def site_key():
    """Return the Turnstile site key."""
    return jsonify({"siteKey": TURNSTILE_SITE_KEY})


if __name__ == "__main__":
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not set in the .env file")
    if not TURNSTILE_SECRET_KEY or not TURNSTILE_SITE_KEY:
        raise ValueError("Turnstile keys are not set in the .env file")
    app.run(debug=DEBUG, port=PORT)
