// ========================================
// TRANSCRIPATOR - Main Script
// ========================================

// Global variables
let currentJobId = null;
let currentFile = null;
let isProcessing = false;
let currentActiveTab = null;

// Store original content for clipboard copying
let originalContent = { original: '', improved: '', summary: '' };

// Proof-of-Work variables
let currentPowId = null;
let isPowValid = false;
let powWorker = null;
let currentNonce = null;

// Retry variables
let currentStep = 0;
let retryAttempts = 0;
let maxRetries = 3;
let lastError = null;

// Recording variables
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let audioContext = null;
let analyser = null;
let animationFrameId = null;
let recordingStartTime = null;
let timerInterval = null;
let isPaused = false;
let pausedDuration = 0;
let pauseStartTime = null;

// DOM elements
const uploadArea = document.getElementById('uploadArea');
const audioFile = document.getElementById('audioFile');
const fileSelected = document.getElementById('fileSelected');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const uploadSection = document.getElementById('uploadSection');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const noResults = document.getElementById('noResults');
const processBtn = document.getElementById('processBtn');
const captchaStatus = document.getElementById('captchaStatus');
const retrySection = document.getElementById('retrySection');
const powStatus = document.getElementById('powStatus');

// Step tracking
const stepData = {
    1: { title: 'File Upload & Preprocessing', description: 'Uploading and preparing your audio file...', icon: 'fas fa-upload' },
    2: { title: 'AI Transcription', description: 'Converting speech to text using Whisper AI...', icon: 'fas fa-microphone' },
    3: { title: 'Text Enhancement', description: 'Improving grammar and readability...', icon: 'fas fa-magic' },
    4: { title: 'Summary Generation', description: 'Creating a concise summary of key points...', icon: 'fas fa-list-ul' }
};

// ========================================
// Initialization
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    setupThemeToggle();
    generatePow();
    resetAll();
});

function setupEventListeners() {
    audioFile.addEventListener('change', handleFileSelection);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
}

// ========================================
// Theme Toggle
// ========================================

function setupThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon(next);
    });
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#themeToggle i');
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// ========================================
// Mode Switching (Upload / Record)
// ========================================

function switchMode(mode) {
    const uploadMode = document.getElementById('uploadMode');
    const recordMode = document.getElementById('recordMode');
    const uploadBtn = document.getElementById('uploadModeBtn');
    const recordBtn = document.getElementById('recordModeBtn');

    if (mode === 'upload') {
        uploadMode.style.display = 'block';
        recordMode.style.display = 'none';
        uploadBtn.classList.add('active');
        recordBtn.classList.remove('active');
        stopRecording();
    } else {
        uploadMode.style.display = 'none';
        recordMode.style.display = 'block';
        uploadBtn.classList.remove('active');
        recordBtn.classList.add('active');
    }
}

// ========================================
// Microphone Recording
// ========================================

async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Set up audio context for visualization
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyser.fftSize = 256;

        // Set up recorder
        mediaRecorder = new MediaRecorder(audioStream, { mimeType: getSupportedMimeType() });
        audioChunks = [];
        isPaused = false;
        pausedDuration = 0;
        pauseStartTime = null;

        // Hide previous download button
        const dlBtn = document.getElementById('downloadRecordingBtn');
        if (dlBtn) dlBtn.style.display = 'none';

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            const extension = mediaRecorder.mimeType.includes('webm') ? 'webm' : 'ogg';
            const file = new File([blob], 'recording.' + extension, { type: mediaRecorder.mimeType });

            // Show download button
            const dlBtn = document.getElementById('downloadRecordingBtn');
            if (dlBtn) {
                const url = URL.createObjectURL(blob);
                dlBtn.href = url;
                dlBtn.download = 'recording.' + extension;
                dlBtn.style.display = 'inline-flex';
            }

            processFileSelection(file);
            cleanupRecording();
        };

        mediaRecorder.start(100);
        recordingStartTime = Date.now();

        // UI updates
        const btn = document.getElementById('recordBtn');
        const label = document.getElementById('recordLabel');
        const pauseBtn = document.getElementById('pauseBtn');
        btn.classList.add('recording');
        btn.textContent = '';
        var stopIcon = document.createElement('i');
        stopIcon.className = 'fas fa-stop';
        btn.appendChild(stopIcon);
        label.textContent = 'TAP TO STOP';
        pauseBtn.style.display = 'inline-flex';

        startTimer();
        drawVisualizer();

    } catch (err) {
        console.error('Microphone access error:', err);
        showError('Microphone access denied. Please allow microphone access in your browser settings.');
    }
}

function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        mediaRecorder.stop();
    }

    const btn = document.getElementById('recordBtn');
    const label = document.getElementById('recordLabel');
    const pauseBtn = document.getElementById('pauseBtn');
    btn.classList.remove('recording', 'paused');
    btn.textContent = '';
    var micIcon = document.createElement('i');
    micIcon.className = 'fas fa-microphone';
    btn.appendChild(micIcon);
    label.textContent = 'TAP TO RECORD';
    pauseBtn.style.display = 'none';
    pauseBtn.classList.remove('active');
    isPaused = false;

    stopTimer();
    stopVisualizer();
}

function togglePause() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    if (isPaused) {
        resumeRecording();
    } else {
        pauseRecording();
    }
}

function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        isPaused = true;
        pauseStartTime = Date.now();

        // UI updates
        const recordBtn = document.getElementById('recordBtn');
        const label = document.getElementById('recordLabel');
        const pauseBtn = document.getElementById('pauseBtn');
        
        recordBtn.classList.add('paused');
        label.textContent = 'PAUSED';
        
        pauseBtn.classList.add('active');
        pauseBtn.textContent = '';
        var playIcon = document.createElement('i');
        playIcon.className = 'fas fa-play';
        pauseBtn.appendChild(playIcon);

        stopTimer();
        stopVisualizer();
    }
}

function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        isPaused = false;
        
        // Update paused duration
        if (pauseStartTime) {
            pausedDuration += Date.now() - pauseStartTime;
            pauseStartTime = null;
        }

        // UI updates
        const recordBtn = document.getElementById('recordBtn');
        const label = document.getElementById('recordLabel');
        const pauseBtn = document.getElementById('pauseBtn');
        
        recordBtn.classList.remove('paused');
        label.textContent = 'TAP TO STOP';
        
        pauseBtn.classList.remove('active');
        pauseBtn.textContent = '';
        var pauseIcon = document.createElement('i');
        pauseIcon.className = 'fas fa-pause';
        pauseBtn.appendChild(pauseIcon);

        startTimer();
        drawVisualizer();
    }
}

function cleanupRecording() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    analyser = null;
}

function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
}

// Timer
function startTimer() {
    const timerEl = document.getElementById('recordTimer');
    timerInterval = setInterval(() => {
        const currentPausedDuration = isPaused && pauseStartTime ? (Date.now() - pauseStartTime) : 0;
        const totalPausedTime = pausedDuration + currentPausedDuration;
        const elapsed = Math.floor((Date.now() - recordingStartTime - totalPausedTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerEl.textContent = mins + ':' + secs;
    }, 200);
}

function stopTimer() {
    clearInterval(timerInterval);
    document.getElementById('recordTimer').textContent = '00:00';
}

// Audio Visualizer
function drawVisualizer() {
    const canvas = document.getElementById('audioCanvas');
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Set canvas resolution
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    function draw() {
        animationFrameId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        // Get theme colors
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDark ? '#111118' : '#f0f0f0';
        ctx.fillRect(0, 0, width, height);

        var barWidth = (width / bufferLength) * 2.5;
        var x = 0;

        for (var i = 0; i < bufferLength; i++) {
            var barHeight = (dataArray[i] / 255) * height * 0.85;
            var gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
            gradient.addColorStop(0, '#d90429');
            gradient.addColorStop(1, '#8b0000');
            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
        }
    }

    draw();
}

function stopVisualizer() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    var canvas = document.getElementById('audioCanvas');
    var ctx = canvas.getContext('2d');
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.fillStyle = isDark ? '#111118' : '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ========================================
// Proof-of-Work
// ========================================

function initPowWorker() {
    if (powWorker) powWorker.terminate();

    powWorker = new Worker('/static/pow-worker.js');

    powWorker.onmessage = function(e) {
        var data = e.data;
        switch (data.type) {
            case 'started':
                setPowStatusComputing();
                break;
            case 'progress':
                break;
            case 'solution':
                currentNonce = data.nonce;
                setPowStatusSolved();
                validatePow(data.nonce);
                break;
            case 'error':
                setPowStatusError();
                setTimeout(function() { generatePow(); }, 3000);
                break;
        }
    };

    powWorker.onerror = function() {
        setPowStatusError();
        setTimeout(function() { generatePow(); }, 3000);
    };
}

function setPowStatusComputing() {
    while (powStatus.firstChild) powStatus.removeChild(powStatus.firstChild);
    var icon = document.createElement('i');
    icon.className = 'fas fa-shield-alt fa-pulse';
    powStatus.appendChild(icon);
    var span = document.createElement('span');
    span.textContent = 'Verifying security...';
    powStatus.appendChild(span);
    powStatus.className = 'pow-status computing';
}

function setPowStatusSolved() {
    while (powStatus.firstChild) powStatus.removeChild(powStatus.firstChild);
    var icon = document.createElement('i');
    icon.className = 'fas fa-check-circle';
    powStatus.appendChild(icon);
    var span = document.createElement('span');
    span.textContent = 'Security verified';
    powStatus.appendChild(span);
    powStatus.className = 'pow-status solved';
}

function setPowStatusError() {
    while (powStatus.firstChild) powStatus.removeChild(powStatus.firstChild);
    var icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-triangle';
    powStatus.appendChild(icon);
    var span = document.createElement('span');
    span.textContent = 'Verification failed';
    powStatus.appendChild(span);
    powStatus.className = 'pow-status error';
}

function setPowStatusDefault() {
    while (powStatus.firstChild) powStatus.removeChild(powStatus.firstChild);
    var icon = document.createElement('i');
    icon.className = 'fas fa-shield-alt';
    powStatus.appendChild(icon);
    var span = document.createElement('span');
    span.textContent = 'Verifying security...';
    powStatus.appendChild(span);
    powStatus.className = 'pow-status';
}

async function generatePow() {
    try {
        setPowStatusDefault();
        isPowValid = false;
        currentNonce = null;
        currentPowId = null;
        captchaStatus.textContent = '';
        captchaStatus.className = 'captcha-status';

        var response = await fetch('/generate-pow', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!response.ok) throw new Error('Failed to generate proof-of-work challenge');

        var result = await response.json();
        if (result.success) {
            currentPowId = result.pow_id;
            initPowWorker();
            startPowComputation(result.challenge, result.difficulty);
            updateProcessButton();
        } else {
            throw new Error(result.error || 'Failed to generate challenge');
        }
    } catch (error) {
        setPowStatusError();
        setTimeout(function() { generatePow(); }, 3000);
    }
}

function startPowComputation(challenge, difficulty) {
    if (!powWorker) initPowWorker();
    powWorker.postMessage({ type: 'solve', challenge: challenge, difficulty: difficulty });
}

async function validatePow(nonce) {
    if (!currentPowId || !nonce) return;

    try {
        var response = await fetch('/validate-pow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pow_id: currentPowId, nonce: nonce })
        });

        if (!response.ok) throw new Error('Failed to validate proof-of-work');
        var result = await response.json();

        if (result.success && result.valid) {
            isPowValid = true;
            captchaStatus.textContent = '';
            var checkIcon = document.createElement('i');
            checkIcon.className = 'fas fa-check';
            captchaStatus.appendChild(checkIcon);
            var readyText = document.createTextNode(' Ready to proceed');
            captchaStatus.appendChild(readyText);
            captchaStatus.className = 'captcha-status correct';
        } else {
            isPowValid = false;
            setTimeout(function() { generatePow(); }, 1000);
        }
    } catch (error) {
        isPowValid = false;
        setTimeout(function() { generatePow(); }, 2000);
    }

    updateProcessButton();
}

function updateProcessButton() {
    if (currentFile && isPowValid && currentPowId && !isProcessing) {
        processBtn.disabled = false;
        processBtn.textContent = '';
        var icon = document.createElement('i');
        icon.className = 'fas fa-play';
        processBtn.appendChild(icon);
        processBtn.appendChild(document.createTextNode(' START PROCESSING'));
    } else if (currentFile && !isPowValid) {
        processBtn.disabled = true;
        processBtn.textContent = '';
        var icon2 = document.createElement('i');
        icon2.className = 'fas fa-shield-alt fa-pulse';
        processBtn.appendChild(icon2);
        processBtn.appendChild(document.createTextNode(' VERIFYING...'));
    } else if (!currentFile) {
        processBtn.disabled = true;
        processBtn.textContent = '';
        var icon3 = document.createElement('i');
        icon3.className = 'fas fa-play';
        processBtn.appendChild(icon3);
        processBtn.appendChild(document.createTextNode(' START PROCESSING'));
    } else {
        processBtn.disabled = true;
        processBtn.textContent = '';
        var icon4 = document.createElement('i');
        icon4.className = 'fas fa-hourglass-half';
        processBtn.appendChild(icon4);
        processBtn.appendChild(document.createTextNode(' PLEASE WAIT...'));
    }
}

// ========================================
// File Handling
// ========================================

function handleFileSelection(event) {
    var file = event.target.files[0];
    if (file) processFileSelection(file);
}

function handleDragOver(event) {
    event.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(event) {
    event.preventDefault();
    uploadArea.classList.remove('dragover');
    var files = event.dataTransfer.files;
    if (files.length > 0) {
        if (files[0].type.startsWith('audio/')) {
            processFileSelection(files[0]);
        } else {
            showError('Please select a valid audio file.');
        }
    }
}

function processFileSelection(file) {
    var maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
        showError('File size exceeds 100MB limit.');
        return;
    }

    var supportedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
        'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/aac',
        'audio/x-wav', 'audio/webm', 'audio/x-ms-wma',
        'audio/x-aiff', 'audio/flac'
    ];

    if (!supportedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a|ogg|flac|webm|wma|aiff|aac)$/i)) {
        showError('Unsupported file format.');
        return;
    }

    currentFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);

    // Hide both modes, show file selected
    document.getElementById('uploadMode').style.display = 'none';
    document.getElementById('recordMode').style.display = 'none';
    document.querySelector('.mode-toggle').style.display = 'none';
    uploadArea.style.display = 'none';
    fileSelected.style.display = 'block';

    updateProcessButton();
    showSuccess('File ready for processing.');
}

// ========================================
// Processing Pipeline
// ========================================

async function startProcessing() {
    if (!currentFile || isProcessing) return;
    if (!isPowValid || !currentPowId) {
        showError('Security verification still in progress. Please wait.');
        return;
    }

    isProcessing = true;
    updateProcessButton();
    hideRetrySection();

    uploadSection.style.display = 'none';
    resultsSection.style.display = 'block';
    progressSection.style.display = 'block';

    resetProgress();
    showNoResults();

    try {
        currentStep = 1;
        await processStep1();
        currentStep = 2;
        await processStep2();
        currentStep = 3;
        await processStep3();
        currentStep = 4;
        await processStep4();
        showProcessingComplete();
    } catch (error) {
        lastError = error;
        isProcessing = false;
        updateProcessButton();

        if (error.message.includes('pow') || error.message.includes('PoW')) {
            showError('Security verification expired. Regenerating...');
            generatePow();
        } else {
            showRetryOptions(currentStep, error.message);
        }
    }
}

async function processStep1() {
    updateCurrentStep(1, 'processing', 'Uploading and preprocessing...');
    updateOverallProgress(10);

    if (!currentPowId) throw new Error('Security verification required.');

    var formData = new FormData();
    formData.append('audio', currentFile);
    formData.append('pow_id', currentPowId);

    var response = await fetch('/process-audio', { method: 'POST', body: formData });

    if (!response.ok) {
        var error = await response.json();
        if (error.error && (error.error.includes('pow') || error.error.includes('PoW'))) {
            currentPowId = null;
            isPowValid = false;
            updateProcessButton();
            generatePow();
            throw new Error('Security verification expired. Please wait and try again.');
        }
        throw new Error(error.error || 'Upload failed');
    }

    var result = await response.json();
    currentJobId = result.job_id;
    currentPowId = null;
    isPowValid = false;
    setTimeout(function() { generatePow(); }, 1000);

    updateCurrentStep(1, 'completed', 'File uploaded successfully');
    updateStepIndicator(1, 'completed');
    updateOverallProgress(25);
    await delay(500);
}

async function processStep2() {
    updateCurrentStep(2, 'processing', 'Converting speech to text...');
    updateStepIndicator(2, 'active');
    updateOverallProgress(30);

    var response = await fetch('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: currentJobId })
    });

    if (!response.ok) {
        var error = await response.json();
        throw new Error(error.error || 'Transcription failed');
    }

    var result = await response.json();
    showResult('original', result.original_transcription);
    updateCurrentStep(2, 'completed', 'Transcription completed');
    updateStepIndicator(2, 'completed');
    updateOverallProgress(50);
    await delay(500);
}

async function processStep3() {
    updateCurrentStep(3, 'processing', 'Enhancing text quality...');
    updateStepIndicator(3, 'active');
    updateOverallProgress(60);

    var originalText = document.getElementById('originalText').textContent;
    var response = await fetch('/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: currentJobId, transcription: originalText })
    });

    if (!response.ok) {
        var error = await response.json();
        throw new Error(error.error || 'Enhancement failed');
    }

    var result = await response.json();
    showResult('improved', result.improved_transcription);
    updateCurrentStep(3, 'completed', 'Text enhanced successfully');
    updateStepIndicator(3, 'completed');
    updateOverallProgress(75);
    await delay(500);
}

async function processStep4() {
    updateCurrentStep(4, 'processing', 'Generating summary...');
    updateStepIndicator(4, 'active');
    updateOverallProgress(85);

    var improvedText = document.getElementById('improvedText').textContent;
    var response = await fetch('/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: currentJobId, transcription: improvedText })
    });

    if (!response.ok) {
        var error = await response.json();
        throw new Error(error.error || 'Summarization failed');
    }

    var result = await response.json();
    showResult('summary', result.summary);
    updateCurrentStep(4, 'completed', 'Summary generated');
    updateStepIndicator(4, 'completed');
    updateOverallProgress(100);
    await delay(500);
}

function showProcessingComplete() {
    updateCurrentStep(4, 'completed', 'All steps completed!');
    isProcessing = false;
    retryAttempts = 0;
    showSuccess('Processing completed successfully!');
}

// ========================================
// Retry Logic
// ========================================

async function retryCurrentStep() {
    if (retryAttempts >= maxRetries) {
        showError('Maximum retry attempts reached. Please start over.');
        return;
    }

    retryAttempts++;
    updateRetryCount();
    hideRetrySection();
    isProcessing = true;
    updateProcessButton();

    try {
        for (var step = currentStep; step <= 4; step++) {
            currentStep = step;
            switch (step) {
                case 1: await processStep1(); break;
                case 2: await processStep2(); break;
                case 3: await processStep3(); break;
                case 4: await processStep4(); break;
            }
        }
        showProcessingComplete();
    } catch (error) {
        lastError = error;
        isProcessing = false;
        updateProcessButton();
        showRetryOptions(currentStep, error.message);
    }
}

function retryFromBeginning() {
    retryAttempts = 0;
    currentStep = 0;
    hideRetrySection();
    generatePow();
    showError('Security verification restarted. Please wait.');
}

function showRetryOptions(step, errorMessage) {
    document.getElementById('retryErrorText').textContent = errorMessage;
    document.getElementById('retryStepInfo').textContent = 'Failed at: Step ' + step + ' - ' + stepData[step].title;
    updateRetryCount();

    var retryStepBtn = document.getElementById('retryStepBtn');
    if (retryAttempts >= maxRetries) {
        retryStepBtn.disabled = true;
        retryStepBtn.textContent = '';
        var banIcon = document.createElement('i');
        banIcon.className = 'fas fa-ban';
        retryStepBtn.appendChild(banIcon);
        retryStepBtn.appendChild(document.createTextNode(' MAX RETRIES'));
        retryStepBtn.style.opacity = '0.5';
    } else {
        retryStepBtn.disabled = false;
        retryStepBtn.textContent = '';
        var redoIcon = document.createElement('i');
        redoIcon.className = 'fas fa-redo';
        retryStepBtn.appendChild(redoIcon);
        retryStepBtn.appendChild(document.createTextNode(' RETRY STEP'));
        retryStepBtn.style.opacity = '1';
    }

    retrySection.style.display = 'flex';
}

function hideRetrySection() {
    retrySection.style.display = 'none';
}

function updateRetryCount() {
    var el = document.getElementById('retryCount');
    var att = document.getElementById('retryAttempts');
    if (retryAttempts > 0) {
        el.style.display = 'block';
        att.textContent = retryAttempts;
    } else {
        el.style.display = 'none';
    }
}

// ========================================
// Results / Tabs
// ========================================

function showResult(tabType, content) {
    hideNoResults();
    originalContent[tabType] = content;

    var contentElement = document.getElementById(tabType + 'Text');
    if (tabType === 'summary') {
        marked.setOptions({ breaks: true, gfm: true });
        // marked.parse is a trusted library rendering user's own transcription content
        contentElement.innerHTML = marked.parse(content);
    } else {
        contentElement.textContent = content;
    }

    document.getElementById(tabType + 'Tab').style.display = 'flex';
    activateTab(tabType);
}

function activateTab(tabType) {
    document.querySelectorAll('.tab-content').forEach(function(c) { c.style.display = 'none'; });
    document.querySelectorAll('.tab-btn').forEach(function(t) { t.classList.remove('active'); });

    var tabBtn = document.getElementById(tabType + 'Tab');
    var tabContent = document.getElementById(tabType + 'Content');
    if (tabBtn && tabContent) {
        tabBtn.classList.add('active');
        tabContent.style.display = 'block';
        currentActiveTab = tabType;
    }
}

function showTab(tabType) { activateTab(tabType); }

function showNoResults() {
    noResults.style.display = 'block';
    document.querySelectorAll('.tab-btn').forEach(function(t) { t.style.display = 'none'; t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.style.display = 'none'; });
    currentActiveTab = null;
}

function hideNoResults() { noResults.style.display = 'none'; }

// ========================================
// Progress UI
// ========================================

function updateCurrentStep(stepNumber, status, message) {
    var step = stepData[stepNumber];
    var iconEl = document.getElementById('currentStepIcon');
    iconEl.textContent = '';
    var stepIcon = document.createElement('i');
    stepIcon.className = step.icon;
    iconEl.appendChild(stepIcon);

    document.getElementById('currentStepTitle').textContent = step.title;
    document.getElementById('currentStepDescription').textContent = step.description;

    var statusEl = document.getElementById('currentStepStatus');
    statusEl.className = 'step-status ' + status;

    var icons = { processing: 'fa-spinner fa-spin', completed: 'fa-check', error: 'fa-times' };
    statusEl.textContent = '';
    var statusIcon = document.createElement('i');
    statusIcon.className = 'fas ' + (icons[status] || '');
    statusEl.appendChild(statusIcon);
    statusEl.appendChild(document.createTextNode(' '));
    var msgSpan = document.createElement('span');
    msgSpan.id = 'currentStepMessage';
    msgSpan.textContent = message;
    statusEl.appendChild(msgSpan);
}

function updateStepIndicator(stepNumber, status) {
    var indicator = document.getElementById('indicator' + stepNumber);
    indicator.classList.remove('active', 'completed');
    if (status) indicator.classList.add(status);
}

function updateOverallProgress(pct) {
    document.getElementById('overallProgress').style.width = pct + '%';
    document.getElementById('overallProgressText').textContent = pct + '%';
}

function resetProgress() {
    updateOverallProgress(0);
    for (var i = 1; i <= 4; i++) updateStepIndicator(i, '');
    document.getElementById('originalText').textContent = '';
    document.getElementById('improvedText').textContent = '';
    document.getElementById('summaryText').textContent = '';
    originalContent = { original: '', improved: '', summary: '' };
    showNoResults();
    updateCurrentStep(1, 'processing', 'Initializing...');
    updateStepIndicator(1, 'active');
}

// ========================================
// Clipboard
// ========================================

async function copyToClipboard(elementId) {
    var tabType = elementId.replace('Text', '');
    var text = originalContent[tabType] || document.getElementById(elementId).textContent;

    try {
        await navigator.clipboard.writeText(text);
        showSuccess('Copied to clipboard!');
    } catch (err) {
        var textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showSuccess('Copied to clipboard!');
    }
}

// ========================================
// Reset
// ========================================

function resetUpload() {
    currentFile = null;
    audioFile.value = '';
    uploadArea.style.display = 'block';
    fileSelected.style.display = 'none';
    document.getElementById('uploadMode').style.display = 'block';
    document.querySelector('.mode-toggle').style.display = 'flex';
    uploadArea.classList.remove('dragover');
    generatePow();
    updateProcessButton();
}

function resetAll() {
    resetUpload();
    uploadSection.style.display = 'block';
    progressSection.style.display = 'none';
    resultsSection.style.display = 'none';
    hideRetrySection();

    currentJobId = null;
    isProcessing = false;
    currentActiveTab = null;
    currentStep = 0;
    retryAttempts = 0;
    lastError = null;
    currentPowId = null;
    isPowValid = false;

    generatePow();

    if (currentJobId) cleanupJob(currentJobId);
}

async function cleanupJob(jobId) {
    try { await fetch('/cleanup/' + jobId, { method: 'DELETE' }); }
    catch (e) { console.warn('Cleanup failed:', e); }
}

// ========================================
// Messages
// ========================================

function showError(message) {
    var el = document.getElementById('errorMessage');
    document.getElementById('errorText').textContent = message;
    el.style.display = 'block';
    setTimeout(function() { hideError(); }, 5000);
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

function showSuccess(message) {
    var el = document.getElementById('successMessage');
    document.getElementById('successText').textContent = message;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 3000);
}

// ========================================
// Utilities
// ========================================

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    var k = 1024;
    var sizes = ['Bytes', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function delay(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (currentJobId) cleanupJob(currentJobId);
    cleanupRecording();
});
