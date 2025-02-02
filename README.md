# Audio Transcription Web App

A modern web application that transcribes audio files, improves the transcription, and generates a summary using Groq's AI models. Features real-time updates and secure file processing with Cloudflare Turnstile protection.

## Features

- Drag and drop or click to upload audio files
- Real-time transcription updates as processing happens
- Cloudflare Turnstile protection against abuse
- Beautiful, responsive UI with modern gradient design
- Supports multiple audio formats (MP3, WAV, OGG, M4A, etc.)
- File size limit of 25MB
- Three-stage processing:
  1. Initial transcription
  2. Improved transcription with better formatting
  3. Concise summary generation
- Comprehensive error handling and validation

## Prerequisites

- Python 3.7 or higher
- Groq API key
- Cloudflare Turnstile site and secret keys
- Flask

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd audio-transcription-app
```

2. Install the required packages:

```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the root directory and add your API keys:

```env
GROQ_API_KEY=your_groq_api_key_here
TURNSTILE_SITE_KEY=your_turnstile_site_key_here
TURNSTILE_SECRET_KEY=your_turnstile_secret_key_here
```

To get your Turnstile keys:
1. Go to the Cloudflare dashboard (https://dash.cloudflare.com)
2. Navigate to "Turnstile"
3. Click "Add Site"
4. Copy the site key and secret key

## Usage

1. Start the Flask development server:

```bash
python app.py
```

2. Open your web browser and navigate to `http://localhost:5000`

3. Upload an audio file by either:
   - Dragging and dropping the file onto the upload area
   - Clicking the upload area and selecting a file

4. Complete the Turnstile verification

5. Click "Process Audio" to start transcription

6. Watch as the processing happens in real-time:
   - Initial transcription appears immediately
   - Improved version follows shortly after
   - Summary is generated last

## Development

The application is built with:

- Flask (Backend)
- TailwindCSS (Styling)
- Vanilla JavaScript (Frontend)
- Groq API (AI Models)
- Cloudflare Turnstile (Security)

## Project Structure

```
.
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── static/
│   └── script.js      # Frontend JavaScript
├── templates/
│   └── index.html     # Main HTML template
└── .env               # Environment variables
```

## Security Features

- Cloudflare Turnstile protection against automated abuse
- Secure file handling with temporary storage
- Automatic file cleanup after processing
- File type validation
- Size restrictions
- Secure filename handling

## Error Handling

The application includes comprehensive error handling for:

- Invalid file types
- File size limits
- API errors
- Processing failures
- CAPTCHA verification failures
- Network issues

## Contributing

Feel free to submit issues and enhancement requests!

## License

[MIT License](LICENSE)
