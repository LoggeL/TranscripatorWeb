document.addEventListener('DOMContentLoaded', async () => {
  const dropZone = document.getElementById('drop-zone')
  const fileInput = document.getElementById('file-input')
  const selectedFile = document.getElementById('selected-file')
  const fileName = document.getElementById('file-name')
  const removeFile = document.getElementById('remove-file')
  const processBtn = document.getElementById('process-btn')
  const loading = document.getElementById('loading')
  const loadingStatus = document.getElementById('loading-status')
  const results = document.getElementById('results')
  const transcriptionText = document.getElementById('transcription-text')
  const summaryText = document.getElementById('summary-text')
  const error = document.getElementById('error')
  const turnstileContainer = document.querySelector('.cf-turnstile')

  let currentFile = null
  let turnstileToken = null

  // Initialize Turnstile
  try {
    const response = await fetch('/site-key')
    const { siteKey } = await response.json()
    turnstileContainer.setAttribute('data-sitekey', siteKey)
    window.turnstile.render('.cf-turnstile', {
      callback: function (token) {
        turnstileToken = token
        updateProcessButton()
      },
      'expired-callback': () => {
        turnstileToken = null
        updateProcessButton()
      },
    })
  } catch (err) {
    console.error('Failed to initialize Turnstile:', err)
  }

  function updateProcessButton() {
    processBtn.disabled = !currentFile || !turnstileToken
  }

  // Drag and drop handlers
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.classList.add('border-blue-500')
  })

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500')
  })

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('border-blue-500')
    const file = e.dataTransfer.files[0]
    handleFile(file)
  })

  // Click to upload
  dropZone.addEventListener('click', () => {
    fileInput.click()
  })

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0]
    handleFile(file)
  })

  // Remove file button
  removeFile.addEventListener('click', () => {
    currentFile = null
    fileInput.value = ''
    selectedFile.classList.add('hidden')
    updateProcessButton()
    results.classList.add('hidden')
    error.classList.add('hidden')
  })

  // Process button
  processBtn.addEventListener('click', async () => {
    if (!currentFile || !turnstileToken) return

    const formData = new FormData()
    formData.append('audio', currentFile)
    formData.append('cf-turnstile-response', turnstileToken)

    try {
      error.classList.add('hidden')
      loading.classList.remove('hidden')
      results.classList.add('hidden')
      processBtn.disabled = true

      const response = await fetch('/process-audio', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(
          data.error || 'An error occurred while processing the audio'
        )
      }

      // Handle streaming response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      results.classList.remove('hidden')
      loading.classList.remove('hidden')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n').filter(Boolean)
        for (const line of lines) {
          const data = JSON.parse(line)

          switch (data.type) {
            case 'transcription':
              loadingStatus.textContent = 'Improving transcription...'
              transcriptionText.innerHTML = formatText(data.data)
              break
            case 'improved_transcription':
              loadingStatus.textContent = 'Generating summary...'
              transcriptionText.innerHTML = formatText(data.data)
              break
            case 'summary':
              summaryText.innerHTML = formatText(data.data)
              loading.classList.add('hidden')
              break
            case 'error':
              throw new Error(data.data)
          }
        }
      }
    } catch (err) {
      error.textContent = err.message
      error.classList.remove('hidden')
      results.classList.add('hidden')
    } finally {
      loading.classList.add('hidden')
      processBtn.disabled = false
      // Refresh Turnstile after processing
      window.turnstile.reset()
    }
  })

  function handleFile(file) {
    if (!file) return

    const maxSize = 25 * 1024 * 1024 // 25MB
    const audioTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/wave',
      'audio/ogg',
      'audio/x-m4a',
      'audio/mp4',
      'audio/aac',
      'audio/x-wav',
      'audio/webm',
      'audio/x-ms-wma',
      'audio/x-aiff',
      'audio/flac',
    ]

    if (!audioTypes.includes(file.type)) {
      error.textContent = 'Please upload a valid audio file'
      error.classList.remove('hidden')
      return
    }

    if (file.size > maxSize) {
      error.textContent = 'File size must be less than 25MB'
      error.classList.remove('hidden')
      return
    }

    currentFile = file
    fileName.textContent = file.name
    selectedFile.classList.remove('hidden')
    error.classList.add('hidden')
    results.classList.add('hidden')
    updateProcessButton()
  }

  function formatText(text) {
    return text
      .replace(/\n/g, '<br>')
      .replace(/•/g, '&bull;')
      .replace(/\*/g, '&bull;')
      .trim()
  }
})
