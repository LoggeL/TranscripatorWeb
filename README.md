# Audio Transcription Web App

A modern web application that transcribes audio files, improves the transcription, and generates a summary using Groq's AI models.

## Features

- Drag and drop or click to upload audio files
- Supports MP3, WAV, OGG, and M4A formats
- File size limit of 25MB
- Beautiful, responsive UI with modern design
- Real-time processing status updates
- Transcription and summary generation
- Error handling and validation

## Prerequisites

- Python 3.7 or higher
- Groq API key
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

3. Create a `.env` file in the root directory and add your Groq API key:

```
GROQ_API_KEY=your_api_key_here
```

## Usage

1. Start the Flask development server:

```bash
python app.py
```

2. Open your web browser and navigate to `http://localhost:5000`

3. Upload an audio file by either:

   - Dragging and dropping the file onto the upload area
   - Clicking the upload area and selecting a file

4. Click the "Process Audio" button to start transcription

5. Wait for the processing to complete. The transcription and summary will appear below.

## Development

The application is built with:

- Flask (Backend)
- TailwindCSS (Styling)
- Vanilla JavaScript (Frontend)
- Groq API (AI Models)

## Project Structure

```
.
├── app.py              # Flask application
├── requirements.txt    # Python dependencies
├── static/
│   ├── script.js      # Frontend JavaScript
│   └── style.css      # Custom styles
├── templates/
│   └── index.html     # Main HTML template
└── .env               # Environment variables
```

## Error Handling

The application includes comprehensive error handling for:

- Invalid file types
- File size limits
- API errors
- Processing failures

## Contributing

Feel free to submit issues and enhancement requests!
