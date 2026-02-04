// Proof-of-Work Web Worker
// This runs in a separate thread to avoid blocking the UI

// SHA-256 implementation for Web Worker
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Proof-of-work solver
async function solvePow(challenge, difficulty) {
    const requiredPrefix = "0".repeat(difficulty);
    let nonce = 0;
    let hash = "";
    let attempts = 0;
    const maxAttempts = 1000000; // Prevent infinite loops
    const progressInterval = 1000; // Report progress every 1000 attempts
    
    while (attempts < maxAttempts) {
        const input = challenge + nonce.toString();
        hash = await sha256(input);
        
        if (hash.startsWith(requiredPrefix)) {
            // Found solution!
            self.postMessage({
                type: 'solution',
                nonce: nonce.toString(),
                hash: hash,
                attempts: attempts
            });
            return;
        }
        
        nonce++;
        attempts++;
        
        // Report progress periodically
        if (attempts % progressInterval === 0) {
            self.postMessage({
                type: 'progress',
                attempts: attempts,
                currentHash: hash.substring(0, 8) + '...'
            });
        }
    }
    
    // Max attempts reached
    self.postMessage({
        type: 'error',
        message: 'Maximum attempts reached. Please try again.',
        attempts: attempts
    });
}

// Listen for messages from main thread
self.addEventListener('message', async function(e) {
    const { type, challenge, difficulty } = e.data;
    
    if (type === 'solve') {
        self.postMessage({
            type: 'started',
            message: 'Starting proof-of-work computation...'
        });
        
        await solvePow(challenge, difficulty);
    }
});

// Handle worker errors
self.addEventListener('error', function(e) {
    self.postMessage({
        type: 'error',
        message: 'Worker error: ' + e.message
    });
}); 