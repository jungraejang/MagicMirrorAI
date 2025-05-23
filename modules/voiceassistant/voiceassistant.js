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
		console.log("🚀 [VoiceAssistant] Module starting (Hybrid: Wake Word + Vosk)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.conversation = [];
		this.mediaRecorder = null;
		this.audioStream = null;
		this.wakeWordRecognition = null;
		this.displayTimer = null;
		this.currentState = "waiting";
		this.audioChunks = [];
		this.wakeWordRetryCount = 0;
		this.maxWakeWordRetries = 3;
		
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

		// Add click handler as backup (but main interaction is wake word)
		statusDiv.style.cursor = "pointer";
		statusDiv.onclick = () => {
			if (this.currentState === "waiting") {
				console.log("🖱️ [VoiceAssistant] Manual activation via click");
				this.startCommandRecording();
			}
		};

		switch (this.currentState) {
			case "waiting":
				statusIcon.className = "fas fa-microphone";
				statusText.innerHTML = `Say "${this.config.wakeWord}" (Hybrid mode)`;
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

		return wrapper;
	},

	async initHybridMode() {
		console.log("🔧 [VoiceAssistant] Initializing hybrid mode...");
		
		// Initialize microphone for Vosk recording
		await this.initAudioRecording();
		
		// Initialize wake word detection with Web Speech API
		this.initWakeWordDetection();
	},

	initWakeWordDetection() {
		console.log("🎯 [VoiceAssistant] Initializing wake word detection...");
		
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			console.error("❌ [VoiceAssistant] Web Speech API not supported, fallback to click mode");
			this.currentState = "error";
			this.updateDom();
			return;
		}

		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		
		this.wakeWordRecognition = new SpeechRecognition();
		this.wakeWordRecognition.continuous = true;
		this.wakeWordRecognition.interimResults = false;
		this.wakeWordRecognition.lang = this.config.language;

		this.wakeWordRecognition.onstart = () => {
			console.log("🎤 [VoiceAssistant] Wake word detection started");
			this.wakeWordRetryCount = 0;
		};

		this.wakeWordRecognition.onresult = (event) => {
			const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
			console.log(`🗣️ [VoiceAssistant] Wake word listener heard: "${transcript}"`);
			
			if (transcript.includes(this.config.wakeWord.toLowerCase())) {
				console.log("🎯 [VoiceAssistant] Wake word detected! Switching to Vosk...");
				this.onWakeWordDetected();
			}
		};

		this.wakeWordRecognition.onerror = (event) => {
			console.error(`❌ [VoiceAssistant] Wake word detection error: ${event.error}`);
			
			// Handle network errors gracefully
			if (event.error === 'network') {
				this.wakeWordRetryCount++;
				if (this.wakeWordRetryCount < this.maxWakeWordRetries) {
					console.log(`🔄 [VoiceAssistant] Retrying wake word detection (${this.wakeWordRetryCount}/${this.maxWakeWordRetries})...`);
					setTimeout(() => {
						this.startWakeWordDetection();
					}, 2000);
				} else {
					console.log("⚠️ [VoiceAssistant] Max wake word retries reached, using click mode");
					this.currentState = "error";
					this.updateDom();
				}
			}
		};

		this.wakeWordRecognition.onend = () => {
			// Restart wake word detection if we're in waiting state
			if (this.currentState === "waiting") {
				setTimeout(() => {
					this.startWakeWordDetection();
				}, 1000);
			}
		};

		this.startWakeWordDetection();
	},

	startWakeWordDetection() {
		if (!this.wakeWordRecognition || this.currentState !== "waiting") return;
		
		try {
			this.wakeWordRecognition.start();
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start wake word detection:", error);
		}
	},

	onWakeWordDetected() {
		// Stop wake word detection
		if (this.wakeWordRecognition) {
			this.wakeWordRecognition.stop();
		}
		
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
		}
	},

	async startCommandRecording() {
		if (this.isListening || this.isProcessing || !this.audioStream) {
			console.log("⚠️ [VoiceAssistant] Cannot start recording - already busy or no audio stream");
			return;
		}

		console.log("🎤 [VoiceAssistant] Starting command recording with Vosk...");
		
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
			this.restartWakeWordDetection();
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
			this.restartWakeWordDetection();
		}
	},

	async convertToWav(webmBlob) {
		// Create audio context
		const audioContext = new (window.AudioContext || window.webkitAudioContext)();
		
		// Decode audio data
		const arrayBuffer = await webmBlob.arrayBuffer();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		
		// Resample to 16kHz for Vosk
		const targetSampleRate = 16000;
		const resampledBuffer = this.resampleAudio(audioBuffer, targetSampleRate);
		
		// Get PCM data
		const pcmData = resampledBuffer.getChannelData(0);
		
		// Create WAV file
		const wavBuffer = this.createWavFile(pcmData, targetSampleRate);
		
		return new Blob([wavBuffer], { type: 'audio/wav' });
	},

	resampleAudio(audioBuffer, targetSampleRate) {
		const originalSampleRate = audioBuffer.sampleRate;
		const ratio = originalSampleRate / targetSampleRate;
		const targetLength = Math.round(audioBuffer.length / ratio);
		
		const offlineContext = new OfflineAudioContext(1, targetLength, targetSampleRate);
		const bufferSource = offlineContext.createBufferSource();
		bufferSource.buffer = audioBuffer;
		bufferSource.connect(offlineContext.destination);
		bufferSource.start(0);
		
		return offlineContext.startRendering();
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

	restartWakeWordDetection() {
		// Restart wake word detection after a brief delay
		setTimeout(() => {
			if (this.currentState === "waiting") {
				this.startWakeWordDetection();
			}
		}, 1000);
	},

	processUserInput(userInput) {
		this.setState("processing");
		this.isProcessing = true;

		this.sendSocketNotification("PROCESS_SPEECH", {
			userInput: userInput,
			conversation: this.conversation
		});
	},

	setState(newState) {
		this.currentState = newState;
		this.updateDom(300);

		if (newState === "responding" || newState === "processing") {
			this.startDisplayTimer();
		}
	},

	startDisplayTimer() {
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}

		this.displayTimer = setTimeout(() => {
			this.setState("waiting");
			this.restartWakeWordDetection();
		}, this.config.displayTimeout);
	},

	speak(text) {
		if (!this.config.speechSynthesis) return;

		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = this.config.language;
		utterance.rate = 0.9;
		utterance.pitch = 1;

		utterance.onend = () => {
			this.setState("waiting");
			this.isProcessing = false;
			this.restartWakeWordDetection();
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
						console.log("⚠️ [VoiceAssistant] Empty transcription, returning to wake word detection");
						this.setState("waiting");
						this.restartWakeWordDetection();
					}
				} else {
					console.error(`❌ [VoiceAssistant] Vosk error: ${payload.error}`);
					this.setState("waiting");
					this.isProcessing = false;
					this.restartWakeWordDetection();
				}
				break;

			case "SPEECH_RESPONSE":
				this.setState("responding");
				
				const exchange = {
					user: payload.userInput,
					assistant: payload.response
				};
				
				this.conversation.push(exchange);
				
				if (this.conversation.length > this.config.maxConversationHistory) {
					this.conversation = this.conversation.slice(-this.config.maxConversationHistory);
				}

				this.updateDom(300);
				this.speak(payload.response);
				break;

			case "SPEECH_ERROR":
				console.error("❌ [VoiceAssistant] LLM error:", payload);
				this.setState("waiting");
				this.isProcessing = false;
				this.restartWakeWordDetection();
				break;
		}
	},

	suspend() {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
		if (this.wakeWordRecognition) {
			this.wakeWordRecognition.stop();
		}
		if (this.audioStream) {
			this.audioStream.getTracks().forEach(track => track.stop());
		}
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}
	}
}); 