Module.register("voiceassistant", {
	defaults: {
		wakeWord: "hello mirror",
		language: "en-US",
		enableDisplay: true,
		displayTimeout: 10000, // 10 seconds
		speechSynthesis: true,
		llmEndpoint: "http://192.168.0.109:1234/v1/chat/completions",
		maxConversationHistory: 5,
		systemPrompt: "You are a helpful voice assistant for a smart mirror. Keep responses concise and conversational.",
		debugMode: false,
		useVosk: true,  // Use Vosk for command processing
		useHybridMode: true, // Use Web Speech API for wake word, Vosk for commands
		recordingDuration: 5000  // Recording duration in milliseconds
	},

	requiresVersion: "2.1.0",

	start() {
		Log.info(`Starting module: ${this.name}`);
		console.log("🚀 [VoiceAssistant] Module starting (Conservative Hybrid)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.isWakeWordActive = false;
		this.wakeWordWorking = false;
		this.conversation = [];
		this.mediaRecorder = null;
		this.audioStream = null;
		this.wakeWordRecognition = null;
		this.displayTimer = null;
		this.currentState = "initializing";
		this.audioChunks = [];
		this.initializationComplete = false;
		this.manualMode = false;
		this.currentUserInput = "";
		this.wakeWordAttempts = 0;
		
		// Send config to node helper
		this.sendSocketNotification("CONFIG", this.config);
		console.log("📡 [VoiceAssistant] Config sent to node helper");
		
		// Initialize hybrid mode
		setTimeout(() => {
			this.initHybridMode();
		}, 2000);
	},

	getStyles() {
		return ["voiceassistant.css"];
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "voice-assistant";

		if (!this.config.enableDisplay) {
			wrapper.style.display = "none";
			return wrapper;
		}

		const statusDiv = document.createElement("div");
		statusDiv.className = `status-indicator ${this.currentState}`;
		
		const statusIcon = document.createElement("i");
		const statusText = document.createElement("span");
		statusText.className = "status-text";

		// Add click handler
		statusDiv.style.cursor = "pointer";
		statusDiv.onclick = () => {
			console.log(`🖱️ [VoiceAssistant] Click - State: ${this.currentState}, Manual: ${this.manualMode}`);
			
			if (this.currentState === "waiting" && this.initializationComplete) {
				this.startCommandRecording();
			} else if (this.currentState === "error" || this.manualMode) {
				this.startCommandRecording();
			}
		};

		switch (this.currentState) {
			case "initializing":
				statusIcon.className = "fas fa-spinner fa-spin";
				statusText.innerHTML = "Initializing...";
				break;
			case "waiting":
				statusIcon.className = "fas fa-microphone";
				if (this.manualMode) {
					statusText.innerHTML = "Click to talk (Manual mode)";
				} else if (this.wakeWordWorking) {
					statusText.innerHTML = `Say "${this.config.wakeWord}" or click`;
				} else {
					statusText.innerHTML = "Click to talk";
				}
				break;
			case "listening":
				statusIcon.className = "fas fa-microphone pulse";
				statusText.innerHTML = "Listening for command...";
				break;
			case "processing":
				statusIcon.className = "fas fa-brain spin";
				statusText.innerHTML = "Processing with Vosk...";
				break;
			case "responding":
				statusIcon.className = "fas fa-comment-dots";
				statusText.innerHTML = "Responding...";
				break;
			case "error":
				statusIcon.className = "fas fa-exclamation-triangle";
				statusText.innerHTML = "Click to try again";
				break;
		}

		statusDiv.appendChild(statusIcon);
		statusDiv.appendChild(statusText);
		wrapper.appendChild(statusDiv);

		// Add conversation display
		if (this.conversation && this.conversation.length > 0) {
			const conversationDiv = document.createElement("div");
			conversationDiv.className = "conversation-display";
			
			// Show recent conversations (last 3)
			const recentConversations = this.conversation.slice(-3);
			
			recentConversations.forEach((exchange, index) => {
				// User message
				const userDiv = document.createElement("div");
				userDiv.className = "user-message";
				userDiv.innerHTML = `<i class="fas fa-user"></i> ${exchange.user}`;
				conversationDiv.appendChild(userDiv);
				
				// Assistant response
				const assistantDiv = document.createElement("div");
				assistantDiv.className = "assistant-message";
				assistantDiv.innerHTML = `<i class="fas fa-robot"></i> ${exchange.assistant}`;
				conversationDiv.appendChild(assistantDiv);
			});
			
			wrapper.appendChild(conversationDiv);
		}

		// Show current processing message if any
		if (this.currentUserInput && this.currentState === "processing") {
			const currentDiv = document.createElement("div");
			currentDiv.className = "current-processing";
			currentDiv.innerHTML = `<i class="fas fa-user"></i> ${this.currentUserInput}`;
			wrapper.appendChild(currentDiv);
		}

		return wrapper;
	},

	async initHybridMode() {
		if (this.initializationComplete) {
			console.log("⚠️ [VoiceAssistant] Already initialized, skipping...");
			return;
		}

		console.log("🔧 [VoiceAssistant] Initializing hybrid mode...");
		
		try {
			// Initialize microphone for Vosk recording
			await this.initAudioRecording();
			
			// Try to initialize wake word detection (but don't force it)
			this.tryInitWakeWordDetection();
			
			this.initializationComplete = true;
			this.setState("waiting");
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to initialize hybrid mode:", error);
			this.currentState = "error";
			this.manualMode = true;
			this.updateDom();
		}
	},

	tryInitWakeWordDetection() {
		console.log("🎯 [VoiceAssistant] Attempting wake word detection...");
		
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			console.log("⚠️ [VoiceAssistant] Web Speech API not supported, using manual mode");
			this.manualMode = true;
			return;
		}

		try {
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
			
			this.wakeWordRecognition = new SpeechRecognition();
			this.wakeWordRecognition.continuous = true;
			this.wakeWordRecognition.interimResults = false;
			this.wakeWordRecognition.lang = this.config.language;

			this.wakeWordRecognition.onstart = () => {
				console.log("✅ [VoiceAssistant] Wake word detection STARTED successfully");
				this.isWakeWordActive = true;
				this.wakeWordWorking = true;
				this.wakeWordAttempts = 0; // Reset attempts on success
				this.updateDom();
			};

			this.wakeWordRecognition.onresult = (event) => {
				const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
				console.log(`🗣️ [VoiceAssistant] Wake word heard: "${transcript}"`);
				
				if (transcript.includes(this.config.wakeWord.toLowerCase())) {
					console.log("🎯 [VoiceAssistant] Wake word detected!");
					this.onWakeWordDetected();
				}
			};

			this.wakeWordRecognition.onerror = (event) => {
				console.error(`❌ [VoiceAssistant] Wake word error: ${event.error}`);
				this.isWakeWordActive = false;
				this.wakeWordAttempts++;
				
				if (event.error === 'network') {
					console.log("🌐 [VoiceAssistant] Network error - Web Speech API needs internet connection");
				} else if (event.error === 'not-allowed') {
					console.log("🎤 [VoiceAssistant] Microphone permission denied");
				} else if (event.error === 'service-not-allowed') {
					console.log("🚫 [VoiceAssistant] Speech service not allowed");
				} else if (event.error === 'audio-capture') {
					console.log("🎤 [VoiceAssistant] Audio capture failed");
				} else {
					console.log(`⚠️ [VoiceAssistant] Wake word error: ${event.error}`);
				}
				
				// Increase max attempts to be more persistent
				if (this.wakeWordAttempts >= 5) {  // Increased from 2 to 5
					console.log(`🔄 [VoiceAssistant] Wake word failed ${this.wakeWordAttempts} times - switching to manual mode`);
					this.wakeWordWorking = false;
					this.manualMode = true;
				} else {
					console.log(`🔄 [VoiceAssistant] Wake word attempt ${this.wakeWordAttempts}/5 failed, will retry...`);
				}
				
				this.updateDom();
			};

			this.wakeWordRecognition.onend = () => {
				console.log("🔇 [VoiceAssistant] Wake word detection ended");
				this.isWakeWordActive = false;
				
				// Be more persistent with retries
				if (this.currentState === "waiting" && 
					this.wakeWordWorking && 
					!this.manualMode && 
					this.wakeWordAttempts < 5) {  // Increased from 2 to 5
					
					console.log(`🔄 [VoiceAssistant] Restarting wake word detection (attempt ${this.wakeWordAttempts + 1}/5)...`);
					setTimeout(() => {
						if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
							this.startWakeWordDetection();
						}
					}, 3000);  // Increased delay to 3 seconds
				} else {
					console.log("🔄 [VoiceAssistant] Wake word detection stopped - using manual mode");
					this.manualMode = true;
					this.updateDom();
				}
			};

			// Try to start wake word detection
			this.startWakeWordDetection();
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Wake word setup failed:", error);
			this.manualMode = true;
		}
	},

	startWakeWordDetection() {
		console.log(`🔍 [VoiceAssistant] Checking wake word start conditions:`);
		console.log(`  - isWakeWordActive: ${this.isWakeWordActive}`);
		console.log(`  - wakeWordRecognition exists: ${!!this.wakeWordRecognition}`);
		console.log(`  - currentState: ${this.currentState}`);
		console.log(`  - manualMode: ${this.manualMode}`);
		console.log(`  - wakeWordAttempts: ${this.wakeWordAttempts}`);
		
		if (this.isWakeWordActive) {
			console.log("⚠️ [VoiceAssistant] Wake word already active, skipping start");
			return;
		}
		
		if (!this.wakeWordRecognition) {
			console.log("⚠️ [VoiceAssistant] Wake word recognition not initialized");
			return;
		}
		
		if (this.currentState !== "waiting") {
			console.log(`⚠️ [VoiceAssistant] Not in waiting state (current: ${this.currentState})`);
			return;
		}
		
		if (this.manualMode) {
			console.log("⚠️ [VoiceAssistant] In manual mode, skipping wake word start");
			return;
		}
		
		try {
			console.log("🎤 [VoiceAssistant] Starting wake word detection...");
			this.wakeWordRecognition.start();
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start wake word:", error);
			this.isWakeWordActive = false;
			this.wakeWordWorking = false;
			this.wakeWordAttempts++;
			
			if (this.wakeWordAttempts >= 5) {
				console.log("🔄 [VoiceAssistant] Too many failed start attempts, switching to manual mode");
				this.manualMode = true;
			}
			this.updateDom();
		}
	},

	stopWakeWordDetection() {
		if (this.wakeWordRecognition && this.isWakeWordActive) {
			try {
				this.wakeWordRecognition.stop();
			} catch (error) {
				console.log("⚠️ [VoiceAssistant] Wake word already stopped");
			}
		}
		this.isWakeWordActive = false;
	},

	onWakeWordDetected() {
		// Stop wake word detection
		this.stopWakeWordDetection();
		
		// Start command recording with Vosk
		this.startCommandRecording();
	},

	async initAudioRecording() {
		console.log("🔧 [VoiceAssistant] Initializing audio recording for Vosk...");
		
		try {
			// Request microphone access
			this.audioStream = await navigator.mediaDevices.getUserMedia({ 
				audio: {
					sampleRate: 16000,
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true
				} 
			});
			
			console.log("✅ [VoiceAssistant] Microphone access granted for Vosk");
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to access microphone:", error);
			this.currentState = "error";
			this.updateDom();
			throw error;
		}
	},

	async startCommandRecording() {
		if (this.isListening || this.isProcessing || !this.audioStream) {
			console.log("⚠️ [VoiceAssistant] Cannot start recording - already busy or no audio stream");
			return;
		}

		console.log("🎤 [VoiceAssistant] Starting command recording...");
		
		// Stop wake word detection during command recording
		this.stopWakeWordDetection();
		
		this.setState("listening");
		this.isListening = true;
		this.audioChunks = [];

		try {
			// Create MediaRecorder
			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: 'audio/webm'
			});

			this.mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					this.audioChunks.push(event.data);
				}
			};

			this.mediaRecorder.onstop = () => {
				this.processRecording();
			};

			// Start recording
			this.mediaRecorder.start();

			// Auto-stop after configured duration
			setTimeout(() => {
				if (this.currentState === "listening" && this.mediaRecorder && this.mediaRecorder.state === "recording") {
					this.stopCommandRecording();
				}
			}, this.config.recordingDuration);

		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start command recording:", error);
			this.setState("waiting");
		}
	},

	stopCommandRecording() {
		if (!this.isListening || !this.mediaRecorder) return;

		console.log("🔇 [VoiceAssistant] Stopping command recording...");
		
		this.isListening = false;
		
		if (this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
	},

	async processRecording() {
		console.log("🔄 [VoiceAssistant] Processing recorded audio with Vosk...");
		
		this.setState("processing");
		
		try {
			// Create audio blob
			const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
			console.log(`📊 [VoiceAssistant] Audio blob size: ${audioBlob.size} bytes`);
			
			if (audioBlob.size === 0) {
				console.log("⚠️ [VoiceAssistant] Empty audio blob, returning to waiting");
				this.setState("waiting");
				return;
			}
			
			// Convert to WAV format for Vosk
			const wavBlob = await this.convertToWav(audioBlob);
			console.log(`📊 [VoiceAssistant] WAV blob size: ${wavBlob.size} bytes`);
			
			// Send to node helper for Vosk transcription
			const reader = new FileReader();
			reader.onload = () => {
				const audioData = reader.result;
				console.log(`📡 [VoiceAssistant] Sending ${audioData.byteLength} bytes to Vosk...`);
				this.sendSocketNotification("VOSK_TRANSCRIBE", { audioData: audioData });
			};
			reader.readAsArrayBuffer(wavBlob);
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Error processing recording:", error);
			this.setState("waiting");
		}
	},

	async convertToWav(webmBlob) {
		// Create audio context
		const audioContext = new (window.AudioContext || window.webkitAudioContext)();
		
		try {
			// Decode audio data
			const arrayBuffer = await webmBlob.arrayBuffer();
			const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
			
			// Resample to 16kHz for Vosk
			const targetSampleRate = 16000;
			const resampledBuffer = await this.resampleAudio(audioBuffer, targetSampleRate);
			
			// Get PCM data
			const pcmData = resampledBuffer.getChannelData(0);
			
			// Create WAV file
			const wavBuffer = this.createWavFile(pcmData, targetSampleRate);
			
			return new Blob([wavBuffer], { type: 'audio/wav' });
		} finally {
			// Clean up audio context
			if (audioContext.state !== 'closed') {
				await audioContext.close();
			}
		}
	},

	async resampleAudio(audioBuffer, targetSampleRate) {
		const originalSampleRate = audioBuffer.sampleRate;
		
		if (originalSampleRate === targetSampleRate) {
			return audioBuffer;
		}
		
		const ratio = originalSampleRate / targetSampleRate;
		const targetLength = Math.round(audioBuffer.length / ratio);
		
		const offlineContext = new OfflineAudioContext(1, targetLength, targetSampleRate);
		const bufferSource = offlineContext.createBufferSource();
		bufferSource.buffer = audioBuffer;
		bufferSource.connect(offlineContext.destination);
		bufferSource.start(0);
		
		return await offlineContext.startRendering();
	},

	createWavFile(pcmData, sampleRate) {
		const length = pcmData.length;
		const buffer = new ArrayBuffer(44 + length * 2);
		const view = new DataView(buffer);
		
		// WAV header
		const writeString = (offset, string) => {
			for (let i = 0; i < string.length; i++) {
				view.setUint8(offset + i, string.charCodeAt(i));
			}
		};
		
		writeString(0, 'RIFF');
		view.setUint32(4, 36 + length * 2, true);
		writeString(8, 'WAVE');
		writeString(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		writeString(36, 'data');
		view.setUint32(40, length * 2, true);
		
		// Convert PCM data to 16-bit
		let offset = 44;
		for (let i = 0; i < length; i++) {
			const sample = Math.max(-1, Math.min(1, pcmData[i]));
			view.setInt16(offset, sample * 0x7FFF, true);
			offset += 2;
		}
		
		return buffer;
	},

	processUserInput(userInput) {
		this.setState("processing");
		this.isProcessing = true;
		this.currentUserInput = userInput;
		
		// Clear previous conversation to show only current exchange
		this.conversation = [];
		this.updateDom(100); // Quick update to clear display

		this.sendSocketNotification("PROCESS_SPEECH", {
			userInput: userInput,
			conversation: this.conversation // Send empty conversation for fresh context
		});
	},

	setState(newState) {
		console.log(`🔄 [VoiceAssistant] State change: ${this.currentState} → ${newState}`);
		this.currentState = newState;
		this.updateDom(300);

		if (newState === "responding" || newState === "processing") {
			this.startDisplayTimer();
		}
		
		// Restart wake word detection when entering waiting state
		if (newState === "waiting" && !this.isWakeWordActive && !this.manualMode && this.wakeWordRecognition) {
			setTimeout(() => {
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
					console.log("🔄 [VoiceAssistant] Auto-restarting wake word detection in waiting state");
					this.startWakeWordDetection();
				}
			}, 500);
		}
	},

	startDisplayTimer() {
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}

		this.displayTimer = setTimeout(() => {
			this.setState("waiting");
			this.isProcessing = false;
		}, this.config.displayTimeout);
	},

	speak(text) {
		if (!this.config.speechSynthesis) return;

		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = this.config.language;
		utterance.rate = 0.9;
		utterance.pitch = 1;

		utterance.onend = () => {
			console.log("🔊 [VoiceAssistant] Speech finished, returning to waiting state");
			this.setState("waiting");
			this.isProcessing = false;
			
			// Restart wake word detection after speaking
			setTimeout(() => {
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
					console.log("🔄 [VoiceAssistant] Restarting wake word detection after speech");
					this.startWakeWordDetection();
				}
			}, 1000);
		};

		speechSynthesis.speak(utterance);
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "VOSK_TRANSCRIPTION":
				if (payload.success) {
					console.log(`🗣️ [VoiceAssistant] Vosk transcribed: "${payload.transcript}"`);
					if (payload.transcript && payload.transcript.trim().length > 0) {
						this.processUserInput(payload.transcript);
					} else {
						console.log("⚠️ [VoiceAssistant] Empty transcription, returning to waiting");
						this.setState("waiting");
						this.isProcessing = false;
						this.currentUserInput = "";
					}
				} else {
					console.error(`❌ [VoiceAssistant] Vosk error: ${payload.error}`);
					this.setState("waiting");
					this.isProcessing = false;
					this.currentUserInput = "";
				}
				break;

			case "SPEECH_RESPONSE":
				this.setState("responding");
				
				const exchange = {
					user: payload.userInput,
					assistant: payload.response
				};
				
				// Add only the current exchange (previous ones were cleared)
				this.conversation.push(exchange);

				this.currentUserInput = ""; // Clear current input
				this.updateDom(300);
				this.speak(payload.response);
				break;

			case "SPEECH_ERROR":
				console.error("❌ [VoiceAssistant] LLM error:", payload);
				this.setState("waiting");
				this.isProcessing = false;
				this.currentUserInput = "";
				break;
		}
	},

	suspend() {
		this.initializationComplete = false;
		
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
		if (this.wakeWordRecognition) {
			this.stopWakeWordDetection();
		}
		if (this.audioStream) {
			this.audioStream.getTracks().forEach(track => track.stop());
		}
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}
	}
}); 