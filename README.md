# TranscriptorWeb - AI Audio Transcription & Enhancement

A modern, beautiful web application that transcribes audio files using AI and enhances them with intelligent improvements and summaries. Built with Flask and powered by Groq Whisper for transcription and Cerebras AI for enhancement.

## 🌟 Features

- **🎙️ AI-Powered Transcription**: High-accuracy transcription using Groq's Whisper-large-v3 model
- **✨ Intelligent Enhancement**: Improves grammar, readability, and coherence using Cerebras AI
- **📝 Smart Summarization**: Generates concise, bullet-pointed summaries with key insights
- **🎨 Modern UI**: Beautiful, animated interface with real-time progress tracking
- **📱 Responsive Design**: Works perfectly on desktop, tablet, and mobile devices
- **🎯 Multiple Audio Formats**: Supports MP3, WAV, OGG, M4A, AAC, FLAC, and more
- **📋 One-Click Copy**: Easy copying of transcriptions and summaries to clipboard
- **🔄 Real-Time Processing**: Live progress updates with progressive tab system
- **💾 Large File Support**: Handles audio files up to 25MB
- **🛡️ Background Security**: Invisible proof-of-work system prevents abuse
- **🌐 No Registration Required**: Process audio files instantly without signing up
- **🔁 Smart Retry System**: Automatic retry with error recovery

## 🚀 Live Demo

Experience the app at: [Your deployment URL]

## 🛠️ Technology Stack

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript with modern CSS animations and Web Workers
- **AI Services**: 
  - Groq Whisper (Transcription)
  - Cerebras AI (Enhancement & Summarization)
- **Audio Processing**: PyDub
- **UI Framework**: Custom CSS with Font Awesome icons
- **Security**: Proof-of-Work system with Web Workers

## 📦 Installation

### Prerequisites

- Python 3.8+
- Audio file processing libraries (installed via pip)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/LoggeL/TranscriptorWeb.git
   cd TranscriptorWeb
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   CEREBRAS_API_KEY=your_cerebras_api_key_here
   FLASK_ENV=development
   PORT=5000
   ```

4. **Run the application**
   ```bash
   python app.py
   ```

5. **Access the app**
   Open your browser and navigate to `http://localhost:5000`

## 🔑 API Keys Setup

### Groq API Key
1. Visit [Groq Console](https://console.groq.com)
2. Sign up for an account
3. Generate an API key
4. Add it to your `.env` file as `GROQ_API_KEY`

### Cerebras API Key
1. Visit [Cerebras Cloud](https://cloud.cerebras.ai)
2. Create an account
3. Generate an API key
4. Add it to your `.env` file as `CEREBRAS_API_KEY`

## 🎯 Usage

1. **Upload Audio**: Drag and drop an audio file or click to browse
2. **Automatic Security**: Background verification runs automatically (completely hidden)
3. **Start Processing**: Click the process button once security verification completes
4. **Progressive Results**: Results appear progressively as each step completes:
   - Original transcription appears first
   - Enhanced transcription follows
   - Summary appears last
5. **Tab Navigation**: Switch between different results using the progressive tab system
6. **Copy & Use**: Click copy buttons to easily use the results
7. **Error Recovery**: Automatic retry system handles temporary failures

## 🎨 UI Features

- **Gradient Backgrounds**: Beautiful gradient overlays with glassmorphism effects
- **Smooth Animations**: Fade-in effects, progress bars, and hover animations
- **Progressive Tabs**: Results appear in tabs as each processing step completes
- **Progress Tracking**: Visual step indicators showing upload → transcription → enhancement → summarization
- **Toast Notifications**: Success and error messages with smooth animations
- **Responsive Cards**: Clean, modern card layout that adapts to all screen sizes
- **Smart Retry Modal**: User-friendly error handling with retry options
- **Background Security**: Invisible proof-of-work verification for abuse prevention

## 📄 Supported File Formats

- **MP3** - Most common audio format
- **WAV** - Uncompressed audio
- **OGG** - Open-source audio format
- **M4A** - Apple's audio format
- **AAC** - Advanced Audio Coding
- **FLAC** - Lossless audio compression
- **And more** - Most common audio formats are supported

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GROQ_API_KEY` | API key for Groq transcription service | Yes |
| `CEREBRAS_API_KEY` | API key for Cerebras enhancement service | Yes |
| `FLASK_ENV` | Flask environment (development/production) | No |
| `PORT` | Port number for the Flask app | No (default: 5000) |

### File Size Limits

- Maximum file size: 25MB
- Automatic format conversion for unsupported formats
- Optimized processing for faster results

## 🚀 Deployment

### Local Development
```bash
export FLASK_ENV=development
python app.py
```

### Production Deployment
```bash
export FLASK_ENV=production
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Docker Deployment
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
```

## 🔒 Security & Privacy

- **Background Protection**: Invisible proof-of-work system prevents abuse without user interaction
- **No Data Storage**: Audio files and transcriptions are not stored on our servers
- **Temporary Processing**: Files are processed in memory and immediately deleted
- **API Security**: All API communications are encrypted
- **No User Tracking**: We don't track users or store personal information
- **Challenge-Response**: Cryptographic challenges prevent automated abuse
- **Rate Limiting**: Built-in protection against excessive requests

## 🛡️ Proof of Work (Anti-Abuse)

Instead of CAPTCHAs or user accounts, TranscriptorWeb uses an invisible **Proof-of-Work** system to prevent API abuse:

1. **Challenge Request** — When a user uploads a file, the server generates a random challenge string and a difficulty level (default: 4 leading zeros in the SHA-256 hash).
2. **Background Computation** — A Web Worker (`pow-worker.js`) runs in a separate browser thread, incrementing a nonce until it finds `SHA-256(challenge + nonce)` with the required number of leading zeros. This takes a few seconds on a normal device — invisible to the user.
3. **Server Verification** — The client submits the nonce alongside the transcription request. The server re-hashes `challenge + nonce` and verifies the result in O(1). Challenges expire after 5 minutes.

**Why this works:**
- **No friction** — users never see a CAPTCHA or login screen
- **Expensive to abuse** — each request costs real CPU time, making bulk automated abuse impractical
- **Cheap to verify** — the server checks one hash per request
- **No state needed** — challenges are short-lived and self-contained

Configuration in `app.py`:
```python
POW_DIFFICULTY = 4        # Leading zeros required (~65k attempts avg)
POW_EXPIRES_SECONDS = 300 # Challenge TTL (5 min)
POW_MAX_DIFFICULTY = 6    # Upper bound
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Groq** for providing excellent Whisper transcription API
- **Cerebras** for powerful language model capabilities
- **Font Awesome** for beautiful icons
- **Inter Font** for clean typography

## 📞 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/LoggeL/TranscriptorWeb/issues) page
2. Create a new issue if your problem isn't already reported
3. Provide as much detail as possible including:
   - Audio file format and size
   - Browser and operating system
   - Error messages (if any)

## 🔄 Changelog

### v3.0.0 (Latest)
- 🛡️ Added invisible proof-of-work security system
- 📑 Implemented progressive tab system for results
- 🔁 Added comprehensive retry system with error recovery
- 🎭 Enhanced UI with better animations and feedback
- 🧵 Background processing with Web Workers
- 🔧 Improved error handling and debugging
- 📱 Better mobile responsiveness

### v2.0.0
- ✨ Complete UI redesign with modern animations
- 🔄 Real-time progress tracking
- 🧠 Switched to Cerebras AI for better enhancement and summarization
- 📱 Improved mobile responsiveness
- 🎨 Added glassmorphism effects and smooth animations
- 📋 One-click copy functionality

### v1.0.0
- 🎙️ Basic transcription functionality
- 📝 Summary generation
- 🌐 Web interface

---

**Built with ❤️ by [LoggeL](https://github.com/LoggeL) for the AI community**
