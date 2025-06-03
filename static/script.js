// Global variables
let currentJobId = null;
let currentFile = null;
let isProcessing = false;
let currentActiveTab = null;

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
const powProgress = document.getElementById('powProgress');
const powProgressFill = document.getElementById('powProgressFill');
const powDetails = document.getElementById('powDetails');
const powRefreshBtn = document.getElementById('powRefreshBtn');

// Step tracking
const stepData = {
    1: {
        title: 'File Upload & Preprocessing',
        description: 'Uploading and preparing your audio file...',
        icon: 'fas fa-upload'
    },
    2: {
        title: 'AI Transcription',
        description: 'Converting speech to text using Whisper AI...',
        icon: 'fas fa-microphone'
    },
    3: {
        title: 'Text Enhancement',
        description: 'Improving grammar and readability...',
        icon: 'fas fa-magic'
    },
    4: {
        title: 'Summary Generation',
        description: 'Creating a concise summary of key points...',
        icon: 'fas fa-list-ul'
    }
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    // Start PoW computation silently in background immediately
    generatePow();
    resetAll();
});

// Setup all event listeners
function setupEventListeners() {
    // File input change
    audioFile.addEventListener('change', handleFileSelection);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    // Prevent default drag behaviors on the document
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
}

// Global debug function for testing
window.debugTranscriptor = function() {
    console.log('=== Transcriptor Debug Info ===');
    console.log('Current state:', {
        currentFile: currentFile ? currentFile.name : null,
        isProcessing: isProcessing,
        isPowValid: isPowValid,
        currentPowId: currentPowId,
        currentNonce: currentNonce,
        currentJobId: currentJobId,
        currentStep: currentStep,
        retryAttempts: retryAttempts
    });
    
    // Check PoW store on backend
    fetch('/debug-pow')
        .then(response => response.json())
        .then(data => {
            console.log('Backend PoW store:', data);
        })
        .catch(error => {
            console.error('Failed to fetch backend debug info:', error);
        });
};

// Initialize Web Worker for proof-of-work
function initPowWorker() {
    if (powWorker) {
        powWorker.terminate();
    }
    
    powWorker = new Worker('/static/pow-worker.js');
    
    powWorker.onmessage = function(e) {
        const { type, nonce, attempts } = e.data;
        
        switch (type) {
            case 'started':
                console.log('PoW computation started...');
                // Keep the same "Verifying security..." status, don't show detailed progress
                powStatus.innerHTML = '<i class="fas fa-shield-alt fa-pulse"></i><span>Verifying security...</span>';
                powStatus.className = 'pow-status computing';
                break;
                
            case 'progress':
                // Silently update, no visible progress to user
                console.log('PoW progress:', attempts, 'attempts');
                break;
                
            case 'solution':
                console.log('PoW solution found:', { nonce, attempts });
                currentNonce = nonce;
                powStatus.innerHTML = '<i class="fas fa-check-circle"></i><span>Security verified</span>';
                powStatus.className = 'pow-status solved';
                
                // Validate the solution with the backend silently
                validatePow(nonce);
                break;
                
            case 'error':
                console.error('PoW computation error');
                powStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Verification failed</span>';
                powStatus.className = 'pow-status error';
                
                // Silently retry after a short delay
                setTimeout(() => generatePow(), 3000);
                break;
        }
    };
    
    powWorker.onerror = function(error) {
        console.error('PoW Worker error:', error);
        powStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Verification failed</span>';
        powStatus.className = 'pow-status error';
        
        // Silently retry after a short delay
        setTimeout(() => generatePow(), 3000);
    };
}

// Generate a new proof-of-work challenge from backend
async function generatePow() {
    try {
        console.log('Generating new PoW challenge...');
        
        // Show verifying status without revealing it's generating
        powStatus.innerHTML = '<i class="fas fa-shield-alt"></i><span>Verifying security...</span>';
        powStatus.className = 'pow-status';
        isPowValid = false;
        currentNonce = null;
        currentPowId = null;
        captchaStatus.textContent = '';
        captchaStatus.className = 'captcha-status';
        
        const response = await fetch('/generate-pow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to generate proof-of-work challenge');
        }
        
        const result = await response.json();
        
        if (result.success) {
            currentPowId = result.pow_id;
            console.log('Generated PoW challenge:', { pow_id: currentPowId, difficulty: result.difficulty });
            
            // Initialize worker and start computation silently
            initPowWorker();
            startPowComputation(result.challenge, result.difficulty);
            
            updateProcessButton();
        } else {
            throw new Error(result.error || 'Failed to generate challenge');
        }
        
    } catch (error) {
        console.error('Error generating PoW challenge:', error);
        powStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>Verification failed</span>';
        powStatus.className = 'pow-status error';
        
        // Silently retry after a short delay
        setTimeout(() => generatePow(), 3000);
    }
}

// Start proof-of-work computation
function startPowComputation(challenge, difficulty) {
    if (!powWorker) {
        initPowWorker();
    }
    
    powWorker.postMessage({
        type: 'solve',
        challenge: challenge,
        difficulty: difficulty
    });
}

// Validate proof-of-work solution with backend
async function validatePow(nonce) {
    if (!currentPowId || !nonce) {
        console.warn('validatePow called without required data:', { currentPowId, nonce });
        return;
    }
    
    console.log('Validating PoW solution with backend...', { pow_id: currentPowId, nonce });
    
    try {
        const response = await fetch('/validate-pow', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pow_id: currentPowId,
                nonce: nonce
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to validate proof-of-work');
        }
        
        const result = await response.json();
        console.log('PoW validation response:', result);
        
        if (result.success) {
            if (result.valid) {
                // Solution is valid - show success silently
                isPowValid = true;
                captchaStatus.innerHTML = '<i class="fas fa-check"></i> Ready to proceed';
                captchaStatus.className = 'captcha-status correct';
                
                // Log for debugging
                console.log('PoW validation successful:', currentPowId);
            } else {
                // Solution is invalid - silently regenerate
                console.warn('PoW solution invalid, regenerating...');
                isPowValid = false;
                setTimeout(() => generatePow(), 1000);
            }
        } else {
            // Handle server errors - silently regenerate
            console.warn('PoW validation error:', result.error);
            isPowValid = false;
            setTimeout(() => generatePow(), 2000);
        }
        
    } catch (error) {
        console.error('Error validating PoW:', error);
        isPowValid = false;
        // Silently retry validation
        setTimeout(() => generatePow(), 2000);
    }
    
    updateProcessButton();
}

// Update process button state
function updateProcessButton() {
    if (currentFile && isPowValid && currentPowId && !isProcessing) {
        processBtn.disabled = false;
        processBtn.innerHTML = '<i class="fas fa-play"></i> Start Processing';
    } else if (currentFile && !isPowValid) {
        processBtn.disabled = true;
        processBtn.innerHTML = '<i class="fas fa-shield-alt fa-pulse"></i> Verifying Security...';
    } else if (!currentFile) {
        processBtn.disabled = true;
        processBtn.innerHTML = '<i class="fas fa-play"></i> Start Processing';
    } else {
        processBtn.disabled = true;
        processBtn.innerHTML = '<i class="fas fa-hourglass-half"></i> Please Wait...';
    }
}

// Handle file selection
function handleFileSelection(event) {
    const file = event.target.files[0];
    if (file) {
        processFileSelection(file);
    }
}

// Handle drag over
function handleDragOver(event) {
    event.preventDefault();
    uploadArea.classList.add('dragover');
}

// Handle drag leave
function handleDragLeave(event) {
    event.preventDefault();
    uploadArea.classList.remove('dragover');
}

// Handle file drop
function handleDrop(event) {
    event.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('audio/')) {
            processFileSelection(file);
        } else {
            showError('Please select a valid audio file.');
        }
    }
}

// Process file selection
function processFileSelection(file) {
    // Validate file size (25MB limit)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
        showError('File size exceeds 25MB limit. Please choose a smaller file.');
        return;
    }

    // Validate file type
    const supportedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
        'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/aac',
        'audio/x-wav', 'audio/webm', 'audio/x-ms-wma',
        'audio/x-aiff', 'audio/flac'
    ];

    if (!supportedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a|ogg|flac|webm|wma|aiff|aac)$/i)) {
        showError('Unsupported file format. Please select an audio file.');
        return;
    }

    currentFile = file;
    
    // Display file info
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    // Show file selected state
    uploadArea.style.display = 'none';
    fileSelected.style.display = 'block';
    
    // Update process button state
    updateProcessButton();
    
    if (isPowValid) {
        showSuccess('File selected successfully! Ready to process.');
    } else {
        showSuccess('File selected successfully! Security verification will complete automatically.');
    }
}

// Start the processing pipeline
async function startProcessing() {
    if (!currentFile || isProcessing) {
        console.log('Processing blocked: currentFile =', !!currentFile, ', isProcessing =', isProcessing);
        return;
    }
    
    // Debug current PoW state
    console.log('PoW State Check:', {
        isPowValid: isPowValid,
        currentPowId: currentPowId,
        currentFile: !!currentFile
    });
    
    if (!isPowValid || !currentPowId) {
        console.warn('PoW validation failed:', { isPowValid, currentPowId });
        showError('Security verification is still in progress. Please wait a moment and try again.');
        return;
    }
    
    console.log('Starting processing with PoW ID:', currentPowId);
    
    isProcessing = true;
    updateProcessButton();
    hideRetrySection();
    
    // Show sections and initialize
    uploadSection.style.display = 'none';
    resultsSection.style.display = 'block';
    progressSection.style.display = 'block';
    
    resultsSection.classList.add('fade-in');
    progressSection.classList.add('fade-in');
    
    // Reset progress and show no results initially
    resetProgress();
    showNoResults();
    
    try {
        // Step 1: Upload and preprocessing
        currentStep = 1;
        await processStep1();
        
        // Step 2: Transcription
        currentStep = 2;
        await processStep2();
        
        // Step 3: Improvement
        currentStep = 3;
        await processStep3();
        
        // Step 4: Summarization
        currentStep = 4;
        await processStep4();
        
        // Complete
        showProcessingComplete();
        
    } catch (error) {
        console.error('Processing error:', error);
        lastError = error;
        isProcessing = false;
        updateProcessButton();
        
        // Check if it's a PoW-related error and regenerate if needed
        if (error.message.includes('pow') || error.message.includes('PoW')) {
            showError('Security verification expired. Regenerating...');
            generatePow();
        } else {
            showRetryOptions(currentStep, error.message);
        }
    }
}

// Retry current step
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
        switch (currentStep) {
            case 1:
                await processStep1();
                // Continue with next steps
                currentStep = 2;
                await processStep2();
                currentStep = 3;
                await processStep3();
                currentStep = 4;
                await processStep4();
                break;
            case 2:
                await processStep2();
                // Continue with next steps
                currentStep = 3;
                await processStep3();
                currentStep = 4;
                await processStep4();
                break;
            case 3:
                await processStep3();
                // Continue with next step
                currentStep = 4;
                await processStep4();
                break;
            case 4:
                await processStep4();
                break;
        }
        
        showProcessingComplete();
        
    } catch (error) {
        console.error('Retry failed:', error);
        lastError = error;
        isProcessing = false;
        updateProcessButton();
        showRetryOptions(currentStep, error.message);
    }
}

// Retry from beginning
function retryFromBeginning() {
    retryAttempts = 0;
    currentStep = 0;
    hideRetrySection();
    
    // Generate new challenge for retry silently
    generatePow();
    
    // Show message about new verification
    showError('Security verification restarted. Please wait for completion before retrying.');
}

// Show retry options
function showRetryOptions(step, errorMessage) {
    const stepInfo = stepData[step];
    
    document.getElementById('retryErrorText').textContent = errorMessage;
    document.getElementById('retryStepInfo').textContent = `Failed at: Step ${step} - ${stepInfo.title}`;
    
    updateRetryCount();
    
    // Disable retry step button if max attempts reached
    const retryStepBtn = document.getElementById('retryStepBtn');
    if (retryAttempts >= maxRetries) {
        retryStepBtn.disabled = true;
        retryStepBtn.innerHTML = '<i class="fas fa-ban"></i> Max Retries Reached';
        retryStepBtn.style.opacity = '0.5';
    } else {
        retryStepBtn.disabled = false;
        retryStepBtn.innerHTML = '<i class="fas fa-redo"></i> Retry This Step';
        retryStepBtn.style.opacity = '1';
    }
    
    retrySection.style.display = 'flex';
}

// Hide retry section
function hideRetrySection() {
    retrySection.style.display = 'none';
}

// Update retry count display
function updateRetryCount() {
    const retryCountElement = document.getElementById('retryCount');
    const retryAttemptsElement = document.getElementById('retryAttempts');
    
    if (retryAttempts > 0) {
        retryCountElement.style.display = 'block';
        retryAttemptsElement.textContent = retryAttempts;
    } else {
        retryCountElement.style.display = 'none';
    }
}

// Step 1: Upload and preprocessing
async function processStep1() {
    updateCurrentStep(1, 'processing', 'Uploading and preprocessing...');
    updateOverallProgress(10);
    
    console.log('processStep1: Current PoW ID =', currentPowId);
    
    if (!currentPowId) {
        throw new Error('Security verification required. Please wait for verification to complete.');
    }
    
    const formData = new FormData();
    formData.append('audio', currentFile);
    formData.append('pow_id', currentPowId);
    
    console.log('Sending request with PoW ID:', currentPowId);
    
    const response = await fetch('/process-audio', {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        const error = await response.json();
        console.error('Upload failed:', error);
        
        // If PoW error, regenerate challenge
        if (error.error && (error.error.includes('pow') || error.error.includes('PoW'))) {
            // Clear current PoW state and regenerate
            currentPowId = null;
            isPowValid = false;
            updateProcessButton();
            console.log('PoW error detected, regenerating...');
            generatePow();
            throw new Error('Security verification expired. Please wait for new verification and try again.');
        }
        
        throw new Error(error.error || 'Upload failed');
    }
    
    const result = await response.json();
    currentJobId = result.job_id;
    
    console.log('Upload successful, job ID:', currentJobId);
    
    // Clear pow ID since it's been used
    currentPowId = null;
    isPowValid = false;
    
    // Start generating new PoW for potential future use
    setTimeout(() => generatePow(), 1000);
    
    updateCurrentStep(1, 'completed', 'File uploaded and preprocessed successfully');
    updateStepIndicator(1, 'completed');
    updateOverallProgress(25);
    
    await delay(500);
}

// Step 2: Transcription
async function processStep2() {
    updateCurrentStep(2, 'processing', 'Converting speech to text...');
    updateStepIndicator(2, 'active');
    updateOverallProgress(30);
    
    const response = await fetch('/transcribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            job_id: currentJobId
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Transcription failed');
    }
    
    const result = await response.json();
    
    // Show original transcription result
    showResult('original', result.original_transcription);
    
    updateCurrentStep(2, 'completed', 'Transcription completed successfully');
    updateStepIndicator(2, 'completed');
    updateOverallProgress(50);
    
    await delay(500);
}

// Step 3: Improvement
async function processStep3() {
    updateCurrentStep(3, 'processing', 'Enhancing text quality...');
    updateStepIndicator(3, 'active');
    updateOverallProgress(60);
    
    const originalText = document.getElementById('originalText').textContent;
    
    const response = await fetch('/improve', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            job_id: currentJobId,
            transcription: originalText
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Text improvement failed');
    }
    
    const result = await response.json();
    
    // Show improved transcription result
    showResult('improved', result.improved_transcription);
    
    updateCurrentStep(3, 'completed', 'Text enhanced successfully');
    updateStepIndicator(3, 'completed');
    updateOverallProgress(75);
    
    await delay(500);
}

// Step 4: Summarization
async function processStep4() {
    updateCurrentStep(4, 'processing', 'Generating summary...');
    updateStepIndicator(4, 'active');
    updateOverallProgress(85);
    
    const improvedText = document.getElementById('improvedText').textContent;
    
    const response = await fetch('/summarize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            job_id: currentJobId,
            transcription: improvedText
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Summarization failed');
    }
    
    const result = await response.json();
    
    // Show summary result
    showResult('summary', result.summary);
    
    updateCurrentStep(4, 'completed', 'Summary generated successfully');
    updateStepIndicator(4, 'completed');
    updateOverallProgress(100);
    
    await delay(500);
}

// Show processing complete
function showProcessingComplete() {
    updateCurrentStep(4, 'completed', 'All processing steps completed successfully!');
    isProcessing = false;
    retryAttempts = 0; // Reset retry count on success
    showSuccess('Processing completed successfully!');
}

// Show result with progressive tab system
function showResult(tabType, content) {
    // Hide no results placeholder
    hideNoResults();
    
    // Fill the content
    document.getElementById(`${tabType}Text`).textContent = content;
    
    // Show and activate the tab
    const tabButton = document.getElementById(`${tabType}Tab`);
    const tabContent = document.getElementById(`${tabType}Content`);
    
    // Show the tab button with animation
    tabButton.style.display = 'flex';
    
    // Activate this tab (hide others, show this one)
    activateTab(tabType);
}

// Activate a specific tab
function activateTab(tabType) {
    // Hide all tab contents
    const allContents = document.querySelectorAll('.tab-content');
    allContents.forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    const allTabs = document.querySelectorAll('.tab-btn');
    allTabs.forEach(tab => tab.classList.remove('active'));
    
    // Show and activate the selected tab
    const tabButton = document.getElementById(`${tabType}Tab`);
    const tabContent = document.getElementById(`${tabType}Content`);
    
    if (tabButton && tabContent) {
        tabButton.classList.add('active');
        tabContent.style.display = 'block';
        tabContent.classList.add('active');
        currentActiveTab = tabType;
    }
}

// Manual tab switching (when user clicks on tabs)
function showTab(tabType) {
    activateTab(tabType);
}

// Show no results placeholder
function showNoResults() {
    noResults.style.display = 'block';
    
    // Hide all tabs and content
    const allTabs = document.querySelectorAll('.tab-btn');
    const allContents = document.querySelectorAll('.tab-content');
    
    allTabs.forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    allContents.forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
    });
    
    currentActiveTab = null;
}

// Hide no results placeholder
function hideNoResults() {
    noResults.style.display = 'none';
}

// Update current step display
function updateCurrentStep(stepNumber, status, message) {
    const step = stepData[stepNumber];
    
    // Update icon
    const iconElement = document.getElementById('currentStepIcon');
    iconElement.innerHTML = `<i class="${step.icon}"></i>`;
    
    // Update title and description
    document.getElementById('currentStepTitle').textContent = step.title;
    document.getElementById('currentStepDescription').textContent = step.description;
    
    // Update status
    const statusElement = document.getElementById('currentStepStatus');
    const messageElement = document.getElementById('currentStepMessage');
    
    statusElement.className = `step-status ${status}`;
    messageElement.textContent = message;
    
    if (status === 'processing') {
        statusElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span id="currentStepMessage">' + message + '</span>';
    } else if (status === 'completed') {
        statusElement.innerHTML = '<i class="fas fa-check"></i> <span id="currentStepMessage">' + message + '</span>';
    } else if (status === 'error') {
        statusElement.innerHTML = '<i class="fas fa-times"></i> <span id="currentStepMessage">' + message + '</span>';
    }
}

// Update step indicator
function updateStepIndicator(stepNumber, status) {
    const indicator = document.getElementById(`indicator${stepNumber}`);
    
    // Remove all status classes
    indicator.classList.remove('active', 'completed');
    
    // Add new status
    if (status === 'active') {
        indicator.classList.add('active');
    } else if (status === 'completed') {
        indicator.classList.add('completed');
    }
}

// Update overall progress
function updateOverallProgress(percentage) {
    const progressFill = document.getElementById('overallProgress');
    const progressText = document.getElementById('overallProgressText');
    
    progressFill.style.width = percentage + '%';
    progressText.textContent = percentage + '%';
}

// Reset progress
function resetProgress() {
    // Reset overall progress
    updateOverallProgress(0);
    
    // Reset step indicators
    for (let i = 1; i <= 4; i++) {
        updateStepIndicator(i, '');
    }
    
    // Clear all content
    document.getElementById('originalText').textContent = '';
    document.getElementById('improvedText').textContent = '';
    document.getElementById('summaryText').textContent = '';
    
    // Reset tabs
    showNoResults();
    
    // Set initial step
    updateCurrentStep(1, 'processing', 'Initializing...');
    updateStepIndicator(1, 'active');
}

// Copy to clipboard functionality
async function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    
    try {
        await navigator.clipboard.writeText(text);
        showSuccess('Text copied to clipboard!');
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showSuccess('Text copied to clipboard!');
    }
}

// Reset upload state
function resetUpload() {
    currentFile = null;
    audioFile.value = '';
    uploadArea.style.display = 'block';
    fileSelected.style.display = 'none';
    uploadArea.classList.remove('dragover');
    
    // Reset pow silently
    generatePow();
    updateProcessButton();
}

// Reset everything to initial state
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
    
    // Reset pow silently
    generatePow();
    
    // Cleanup job if exists
    if (currentJobId) {
        cleanupJob(currentJobId);
    }
}

// Cleanup job on server
async function cleanupJob(jobId) {
    try {
        await fetch(`/cleanup/${jobId}`, {
            method: 'DELETE'
        });
    } catch (error) {
        console.warn('Failed to cleanup job:', error);
    }
}

// Show error message
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    
    errorText.textContent = message;
    errorElement.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideError();
    }, 5000);
}

// Hide error message
function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

// Show success message
function showSuccess(message) {
    const successElement = document.getElementById('successMessage');
    const successText = document.getElementById('successText');
    
    successText.textContent = message;
    successElement.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        successElement.style.display = 'none';
    }, 3000);
}

// Utility function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Utility function for delays
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle page unload - cleanup
window.addEventListener('beforeunload', () => {
    if (currentJobId) {
        cleanupJob(currentJobId);
    }
});

// Handle visibility change - pause processing if page hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isProcessing) {
        console.log('Page hidden during processing');
    }
});