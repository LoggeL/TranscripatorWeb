import os
import tempfile
import requests
import uuid # Added for generating unique job IDs
import random # Added for captcha generation
import time # Added for captcha expiration
import hashlib # Added for proof-of-work
import secrets # Added for secure random generation
import re # Added for regex operations to remove <think> tags
from flask import Flask, render_template, request, jsonify # Removed Response, stream_with_context for now
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from pydub import AudioSegment
import mimetypes
import json
import subprocess

# Load environment variables from .env file
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB max file size
app.config["UPLOAD_FOLDER"] = tempfile.gettempdir() # Should be a persistent directory if jobs are long-lived

# In-memory storage for job data (for simplicity)
# In a production app, use a database or a proper cache (Redis, etc.)
job_store = {}

# In-memory storage for proof-of-work captcha data
# Format: {pow_id: {"challenge": str, "difficulty": int, "expires": timestamp, "solved": bool}}
pow_store = {}

# Configuration
PORT = int(os.getenv("PORT", "5000"))
DEBUG = os.getenv("FLASK_ENV", "development") == "development"

# Proof-of-Work configuration
POW_EXPIRES_SECONDS = 300  # 5 minutes
POW_DIFFICULTY = 4  # Number of leading zeros required (4 = ~16 attempts on average)
POW_MAX_DIFFICULTY = 6  # Maximum difficulty to prevent excessive computation

# API configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CEREBRAS_API_KEY = os.getenv("CEREBRAS_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"
CEREBRAS_MODEL = "llama3.1-8b"

# Constants
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB in bytes
GROQ_MAX_FILE_SIZE = 24 * 1024 * 1024  # 24MB - Groq API limit is 25MB, leave margin
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
    "video/webm",
    "video/mp4",
    "video/quicktime",
    "video/x-matroska",
}

SUPPORTED_EXTENSIONS = {
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "mp4",
    "aac",
    "webm",
    "wma",
    "aiff",
    "flac",
    "mov",
    "mkv",
}

# Helper function to generate a unique job ID
def generate_job_id():
    return str(uuid.uuid4())

# Helper function to generate a unique PoW ID
def generate_pow_id():
    return str(uuid.uuid4())

# Helper function to clean expired PoW challenges
def cleanup_expired_pow():
    current_time = time.time()
    expired_ids = [
        pow_id for pow_id, data in pow_store.items()
        if data["expires"] < current_time and data["expires"] > 0  # Don't cleanup used challenges (expires = 0)
    ]
    for pow_id in expired_ids:
        del pow_store[pow_id]

# Helper function to generate secure challenge
def generate_challenge():
    """Generate a cryptographically secure random challenge string."""
    return secrets.token_hex(16)  # 32 character hex string

# Helper function to verify proof-of-work
def verify_pow(challenge, nonce, difficulty):
    """Verify that the nonce produces a hash with required difficulty."""
    hash_input = f"{challenge}{nonce}".encode('utf-8')
    hash_result = hashlib.sha256(hash_input).hexdigest()
    required_prefix = "0" * difficulty
    return hash_result.startswith(required_prefix)

# Helper function to save job data
def save_job_data(job_id, key, value):
    if job_id not in job_store:
        job_store[job_id] = {}
    job_store[job_id][key] = value

# Helper function to get job data
def get_job_data(job_id, key):
    return job_store.get(job_id, {}).get(key)

# Helper function to clean up job files and data
def cleanup_job(job_id):
    data = job_store.pop(job_id, {})
    file_path = data.get("file_path")
    converted_path = data.get("converted_path")
    
    compressed_path = data.get("compressed_path")
    
    for p in set(filter(None, [file_path, converted_path, compressed_path])):
        if os.path.exists(p):
            os.unlink(p)


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


def allowed_file(filename, content_type=None):
    """Check if the file type is allowed for processing."""
    extension = os.path.splitext(filename or "")[1].lower().lstrip(".")
    if extension in SUPPORTED_EXTENSIONS:
        return True

    normalized_content_type = (content_type or "").split(";")[0].strip().lower()
    if normalized_content_type in SUPPORTED_MIMETYPES:
        return True

    mime_type, _ = mimetypes.guess_type(filename or "")
    return mime_type in SUPPORTED_MIMETYPES


def compress_audio_for_groq(file_path: str) -> str:
    """Compress audio to under 24MB for Groq API using ffmpeg/opus."""
    file_size = os.path.getsize(file_path)
    if file_size <= GROQ_MAX_FILE_SIZE:
        return file_path
    
    # Get duration via ffprobe
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", file_path],
            capture_output=True, text=True, timeout=30
        )
        duration = float(result.stdout.strip())
    except Exception as e:
        raise ValueError(f"Failed to get audio duration: {e}")
    
    if duration <= 0:
        raise ValueError("Audio duration is zero or negative")
    
    # Calculate target bitrate (bits per second), targeting 24MB output
    target_bitrate = int((GROQ_MAX_FILE_SIZE * 8) / duration)
    # Cap at 128kbps for quality, minimum 16kbps
    target_bitrate_kbps = max(16, min(128, target_bitrate // 1000))
    
    output_path = os.path.splitext(file_path)[0] + "_compressed.ogg"
    
    try:
        subprocess.run(
            ["ffmpeg", "-i", file_path, "-vn", "-c:a", "libopus",
             "-b:a", f"{target_bitrate_kbps}k", "-y", output_path],
            capture_output=True, text=True, timeout=300, check=True
        )
    except subprocess.CalledProcessError as e:
        raise ValueError(f"FFmpeg compression failed: {e.stderr}")
    
    # Verify output is under limit
    if os.path.getsize(output_path) > GROQ_MAX_FILE_SIZE:
        # Try again with lower bitrate
        target_bitrate_kbps = max(16, target_bitrate_kbps // 2)
        subprocess.run(
            ["ffmpeg", "-i", file_path, "-vn", "-c:a", "libopus",
             "-b:a", f"{target_bitrate_kbps}k", "-y", output_path],
            capture_output=True, text=True, timeout=300, check=True
        )
    
    return output_path


def transcribe_audio(file_path: str) -> str:
    """Transcribe the audio file using Groq's API."""
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    
    with open(file_path, "rb") as f:
        files = {"file": (os.path.basename(file_path), f, "application/octet-stream")}
        data = {
            "model": "whisper-large-v3",
            "response_format": "text", 
            "temperature": 0.0
        }
        response = requests.post(GROQ_API_URL, headers=headers, files=files, data=data)
    
    if response.status_code != 200:
        raise Exception(f"Groq API request failed with status {response.status_code}: {response.text}")
    
    return response.text


def improve_transcription_cerebras(transcription: str) -> str:
    """Improve the transcription using the Cerebras API."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {CEREBRAS_API_KEY}"
    }

    prompt = f'''
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
'''
    
    payload = {
        "model": CEREBRAS_MODEL,
        "stream": False,
        "temperature": 0.3,
        "top_p": 1,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant that improves transcriptions."},
            {"role": "user", "content": prompt}
        ]
    }
    
    response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
    
    if response.status_code != 200:
        raise Exception(f"Cerebras API request failed with status {response.status_code}: {response.text}")
    
    return remove_think_tags(response.json()['choices'][0]['message']['content'])   


def generate_summary_cerebras(transcription: str) -> str:
    """Generate a summary of the transcription using the Cerebras API."""
    headers = {
        "Content-Type": "application/json", 
        "Authorization": f"Bearer {CEREBRAS_API_KEY}"
    }

    prompt = f'''
Task: Summarize the following transcription
Instructions:
1. Provide a concise summary of the main points
2. Use bullet points for clarity
3. Write from the perspective of the transcript
4. Capture the key ideas and any important details
5. Ensure the summary is coherent and easy to understand
6. Use the same language that is used in the transcript (english, german, spanish, ...).
7. ONLY RETURN THE SUMMARY.

Transcription:
{transcription}

Summary:
'''
    
    payload = {
        "model": CEREBRAS_MODEL,
        "stream": False,
        "temperature": 0.5,
        "top_p": 1,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant that summarizes transcriptions."},
            {"role": "user", "content": prompt}
        ]
    }
    
    response = requests.post(CEREBRAS_API_URL, headers=headers, json=payload)
    
    if response.status_code != 200:
        raise Exception(f"Cerebras API request failed with status {response.status_code}: {response.text}")
    
    return remove_think_tags(response.json()['choices'][0]['message']['content'])


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/generate-pow", methods=["POST"])
def generate_pow():
    """Generate a new proof-of-work challenge."""
    try:
        # Clean up expired PoW challenges first
        cleanup_expired_pow()
        
        # Generate PoW challenge
        challenge = generate_challenge()
        difficulty = POW_DIFFICULTY  # Use fixed difficulty for consistency
        
        # Generate unique PoW ID and store
        pow_id = generate_pow_id()
        pow_store[pow_id] = {
            "challenge": challenge,
            "difficulty": difficulty,
            "expires": time.time() + POW_EXPIRES_SECONDS,
            "solved": False
        }
        
        return jsonify({
            "success": True,
            "pow_id": pow_id,
            "challenge": challenge,
            "difficulty": difficulty
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/validate-pow", methods=["POST"])
def validate_pow():
    """Validate a proof-of-work solution."""
    try:
        data = request.get_json()
        pow_id = data.get("pow_id")
        nonce = data.get("nonce")
        
        if not pow_id or nonce is None:
            return jsonify({"success": False, "error": "Missing pow_id or nonce"}), 400
        
        # Clean up expired PoW challenges first
        cleanup_expired_pow()
        
        # Check if PoW challenge exists
        if pow_id not in pow_store:
            print(f"PoW validation failed: pow_id {pow_id} not found in store")
            return jsonify({"success": False, "error": "Invalid or expired PoW challenge"}), 400
        
        pow_data = pow_store[pow_id]
        
        # Check if PoW challenge has expired (but not if it's marked as used with expires=0)
        if pow_data["expires"] > 0 and time.time() > pow_data["expires"]:
            del pow_store[pow_id]
            print(f"PoW validation failed: pow_id {pow_id} has expired")
            return jsonify({"success": False, "error": "PoW challenge has expired"}), 400
        
        # Check if already solved
        if pow_data.get("solved", False):
            print(f"PoW validation: pow_id {pow_id} already solved")
            return jsonify({"success": True, "valid": True})
        
        # Validate nonce
        try:
            nonce = str(nonce)  # Ensure nonce is string
        except (ValueError, TypeError):
            return jsonify({"success": False, "error": "Invalid nonce format"}), 400
        
        if verify_pow(pow_data["challenge"], nonce, pow_data["difficulty"]):
            # PoW is valid - mark it as solved and ready for use
            pow_store[pow_id]["solved"] = True
            pow_store[pow_id]["expires"] = 0  # Mark as used/consumed (won't be cleaned up)
            pow_store[pow_id]["validated_at"] = time.time()  # Track when it was validated
            print(f"PoW validation successful: pow_id {pow_id}, nonce {nonce}")
            return jsonify({"success": True, "valid": True})
        else:
            print(f"PoW validation failed: invalid nonce {nonce} for pow_id {pow_id}")
            return jsonify({"success": True, "valid": False})
            
    except Exception as e:
        print(f"PoW validation error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/process-audio", methods=["POST"])
def process_audio():
    # Check for PoW validation first
    pow_id = request.form.get("pow_id")
    if not pow_id:
        return jsonify({"error": "Proof-of-work validation required"}), 400
    
    # Clean up expired PoW challenges first (but not used ones)
    cleanup_expired_pow()
    
    # Check if PoW challenge exists and is valid (marked as used)
    if pow_id not in pow_store:
        print(f"Audio processing failed: pow_id {pow_id} not found in store")
        return jsonify({"error": "Invalid or expired PoW challenge"}), 400
    
    pow_data = pow_store[pow_id]
    
    # Check if PoW was solved and is ready for consumption (expires = 0 and solved = True)
    if pow_data["expires"] != 0 or not pow_data.get("solved", False):
        print(f"Audio processing failed: pow_id {pow_id} not ready for consumption (expires: {pow_data['expires']}, solved: {pow_data.get('solved', False)})")
        return jsonify({"error": "PoW challenge not solved or not ready"}), 400
    
    # Check if the PoW was validated recently (within 5 minutes to prevent replay attacks)
    validated_at = pow_data.get("validated_at", 0)
    if time.time() - validated_at > 300:  # 5 minutes
        del pow_store[pow_id]
        print(f"Audio processing failed: pow_id {pow_id} validation too old")
        return jsonify({"error": "PoW validation expired"}), 400
    
    # Remove used PoW challenge
    del pow_store[pow_id]
    print(f"Audio processing: pow_id {pow_id} consumed successfully")
    
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files["audio"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    if not allowed_file(file.filename, file.content_type):
        return jsonify({"error": "Unsupported audio format"}), 400

    # Check file size
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if file_size > MAX_FILE_SIZE:
        return jsonify({"error": "File too large. Maximum size is 100MB."}), 400
    
    job_id = generate_job_id()
    filename = secure_filename(file.filename)
    # Ensure UPLOAD_FOLDER exists and is writable
    upload_dir = app.config["UPLOAD_FOLDER"]
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir, exist_ok=True)
        
    original_file_path = os.path.join(upload_dir, f"{job_id}_{filename}")
    file.save(original_file_path)
    
    save_job_data(job_id, "original_filename", filename)
    save_job_data(job_id, "file_path", original_file_path)
    
    processed_file_path = original_file_path
    converted_this_request = False

    try:
        # Convert to supported format if needed
        original_ext = os.path.splitext(original_file_path)[1].lower().lstrip('.')
        # Simpler check: if not mp3, convert to mp3 for whisper
        if original_ext not in ["mp3", "wav", "m4a", "ogg", "flac", "webm"]: # Common formats Whisper supports well
            try:
                # Let's standardize to 'mp3' as Whisper handles it well and it's common
                target_conversion_format = "mp3"
                converted_path = convert_audio(original_file_path, target_conversion_format)
                
                # If conversion created a new file, update path and store converted path for cleanup
                if converted_path != original_file_path:
                    save_job_data(job_id, "converted_path", converted_path)
                    # The original might be kept or deleted by convert_audio, let's assume it might still exist
                    # For safety, we only overwrite processed_file_path if conversion was successful and different
                    processed_file_path = converted_path
                    converted_this_request = True


            except Exception as e:
                cleanup_job(job_id)
                return jsonify({"error": f"Error converting audio format: {str(e)}"}), 500
        
        # Compress if file is too large for Groq API (25MB limit)
        try:
            compressed_path = compress_audio_for_groq(processed_file_path)
            if compressed_path != processed_file_path:
                save_job_data(job_id, "compressed_path", compressed_path)
                processed_file_path = compressed_path
        except Exception as e:
            cleanup_job(job_id)
            return jsonify({"error": f"Error compressing audio for API: {str(e)}"}), 500

        save_job_data(job_id, "processed_file_path", processed_file_path)

        return jsonify({
            "message": "File uploaded and preprocessed successfully.",
            "job_id": job_id,
            "filename": filename,
            "processed_file_path_for_transcription": processed_file_path 
        }), 200

    except Exception as e:
        cleanup_job(job_id) # Clean up if any error during initial processing
        return jsonify({"error": str(e)}), 500


@app.route("/transcribe", methods=["POST"])
def transcribe_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")
    
    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400

    file_path = get_job_data(job_id, "processed_file_path")
    if not file_path or not os.path.exists(file_path):
        return jsonify({"error": "Processed file not found for this job ID. Please upload again."}), 404

    try:
        original_transcription = transcribe_audio(file_path)
        save_job_data(job_id, "original_transcription", original_transcription)
        
        return jsonify({
            "job_id": job_id,
            "original_transcription": original_transcription
        }), 200
    except Exception as e:
        # Consider if cleanup_job(job_id) should be called here or allow retry
        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500

@app.route("/improve", methods=["POST"])
def improve_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")
    original_transcription = data.get("transcription") # Frontend can send it directly

    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400

    if not original_transcription:
        original_transcription = get_job_data(job_id, "original_transcription")
        if not original_transcription:
            return jsonify({"error": "Original transcription not found for this job ID or not provided."}), 404
    
    try:
        improved_transcription = improve_transcription_cerebras(original_transcription)
        save_job_data(job_id, "improved_transcription", improved_transcription)
        
        return jsonify({
            "job_id": job_id,
            "improved_transcription": improved_transcription
        }), 200
    except Exception as e:
        return jsonify({"error": f"Improvement failed: {str(e)}"}), 500

@app.route("/summarize", methods=["POST"])
def summarize_endpoint():
    data = request.get_json()
    job_id = data.get("job_id")
    improved_transcription = data.get("transcription") # Frontend can send it

    if not job_id:
        return jsonify({"error": "Job ID is required"}), 400

    if not improved_transcription:
        improved_transcription = get_job_data(job_id, "improved_transcription")
        if not improved_transcription:
            return jsonify({"error": "Improved transcription not found for this job ID or not provided."}), 404

    try:
        summary = generate_summary_cerebras(improved_transcription)
        save_job_data(job_id, "summary", summary)
        
        # Optionally, clean up the job after summarization is complete
        # cleanup_job(job_id) 
        # Decided to keep files for now, add a separate cleanup endpoint or timeout later

        return jsonify({
            "job_id": job_id,
            "summary": summary
        }), 200
    except Exception as e:
        return jsonify({"error": f"Summarization failed: {str(e)}"}), 500

@app.route("/cleanup/<job_id>", methods=["DELETE"])
def cleanup_endpoint(job_id):
    if not job_id or job_id not in job_store:
        return jsonify({"error": "Job ID not found or invalid"}), 404
    
    try:
        cleanup_job(job_id)
        return jsonify({"message": f"Successfully cleaned up resources for job {job_id}"}), 200
    except Exception as e:
        return jsonify({"error": f"Error during cleanup: {str(e)}"}), 500

@app.route("/debug-pow", methods=["GET"])
def debug_pow():
    """Debug endpoint to check PoW store state."""
    current_time = time.time()
    store_info = {}
    
    for pow_id, data in pow_store.items():
        validated_at = data.get("validated_at", 0)
        store_info[pow_id] = {
            "challenge": data["challenge"][:20] + "...",  # First 20 chars
            "difficulty": data["difficulty"],
            "expires": data["expires"],
            "solved": data.get("solved", False),
            "validated_at": validated_at,
            "expired": current_time > data["expires"] if data["expires"] > 0 else False,
            "time_left": max(0, data["expires"] - current_time) if data["expires"] > 0 else "used",
            "validation_age": current_time - validated_at if validated_at > 0 else "not_validated"
        }
    
    return jsonify({
        "current_time": current_time,
        "store_count": len(pow_store),
        "challenges": store_info
    })

# Helper function to remove <think> tags and their content
def remove_think_tags(text: str) -> str:
    """Remove any content within <think> tags from the text."""
    if not text:
        return text
    
    # Use regex to find and remove <think>...</think> blocks (including nested tags)
    # This handles both single line and multiline think blocks
    pattern = r'<think>.*?</think>'
    cleaned_text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Clean up any extra whitespace that might be left
    cleaned_text = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned_text)  # Remove excessive newlines
    cleaned_text = cleaned_text.strip()
    
    return cleaned_text

if __name__ == "__main__":
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not set in the .env file")
    if not CEREBRAS_API_KEY:
        raise ValueError("CEREBRAS_API_KEY is not set in the .env file")
    
    # Create upload folder if it doesn't exist, good practice
    upload_folder = app.config["UPLOAD_FOLDER"]
    if not os.path.exists(upload_folder):
        try:
            os.makedirs(upload_folder, exist_ok=True)
        except OSError as e:
            # Handle potential race condition or permission issues
            print(f"Error creating upload directory {upload_folder}: {e}")
            # Depending on severity, you might want to exit or log
            
    app.run(debug=DEBUG, port=PORT, host="0.0.0.0")
