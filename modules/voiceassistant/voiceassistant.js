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
		recordingDuration: 5000,  // Recording duration in milliseconds
		wakeWordChunkLength: 2500
	},

	requiresVersion: "2.1.0",

	start() {
		Log.info(`Starting module: ${this.name}`);
		console.log("🚀 [VoiceAssistant] Module starting (Vosk-only mode)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.isWakeWordActive = false;
		this.wakeWordWorking = false;
		this.conversation = [];
		this.mediaRecorder = null;
		this.audioStream = null;
		this.wakeWordInterval = null;
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
		
		// Initialize Vosk mode
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

		console.log("🔧 [VoiceAssistant] Initializing Vosk-only mode...");
		
		try {
			// Initialize microphone for Vosk recording
			await this.initAudioRecording();
			
			// Start continuous Vosk wake word detection
			this.startVoskWakeWordDetection();
			
			this.initializationComplete = true;
			this.setState("waiting");
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to initialize Vosk mode:", error);
			this.currentState = "error";
			this.manualMode = true;
			this.updateDom();
		}
	},

	startVoskWakeWordDetection() {
		console.log("🎯 [VoiceAssistant] Starting Vosk wake word detection...");
		
		if (this.isListening || this.isProcessing) {
			console.log("⚠️ [VoiceAssistant] Already listening or processing, skipping wake word start");
			return;
		}

		this.isWakeWordActive = true;
		this.wakeWordWorking = true;
		this.manualMode = false;
		
		// Start continuous recording for wake word detection
		this.startContinuousRecording();
		this.updateDom();
	},

	async startContinuousRecording() {
		if (this.isListening) {
			console.log(`⚠️ [VoiceAssistant] Already listening, forcing reset...`);
			this.isListening = false;
			// Small delay to let previous recording cleanup
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		
		if (!this.audioStream) {
			console.log(`❌ [VoiceAssistant] No audio stream available`);
			return;
		}

		console.log("🎤 [VoiceAssistant] Starting continuous recording for wake word...");
		console.log(`📊 [VoiceAssistant] State: isWakeWordActive=${this.isWakeWordActive}, isProcessing=${this.isProcessing}`);
		
		this.isListening = true;
		this.audioChunks = [];

		try {
			// Create MediaRecorder for continuous listening
			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: 'audio/webm'
			});

			this.mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					this.audioChunks.push(event.data);
				}
			};

			this.mediaRecorder.onstop = () => {
				this.processContinuousRecording();
			};

			// Start recording
			this.mediaRecorder.start();

			// Simple approach: record for 8 seconds, then process and restart
			this.wakeWordInterval = setTimeout(() => {
				if (this.isWakeWordActive && this.mediaRecorder && this.mediaRecorder.state === "recording") {
					this.mediaRecorder.stop();
				}
			}, this.config.wakeWordChunkLength); // shorter chunks for faster wake-word detection

		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start continuous recording:", error);
			this.isWakeWordActive = false;
			this.wakeWordWorking = false;
			this.manualMode = true;
			this.updateDom();
		}
	},

	async processContinuousRecording() {
		if (!this.isWakeWordActive) return;

		console.log("🔄 [VoiceAssistant] Processing continuous audio for wake word...");
		
		// Reset listening state immediately when processing starts
		this.isListening = false;
		
		try {
			console.log(`📊 [VoiceAssistant] Audio chunks collected: ${this.audioChunks.length}`);
			
			if (this.audioChunks.length === 0) {
				console.log("⚠️ [VoiceAssistant] No audio chunks collected, restarting...");
				this.restartContinuousRecording();
				return;
			}

			// Create audio blob
			const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
			this.audioChunks = []; // Clear for next recording

			console.log(`📊 [VoiceAssistant] Audio blob size: ${audioBlob.size} bytes`);

			if (audioBlob.size === 0) {
				console.log("⚠️ [VoiceAssistant] Empty audio blob, restarting...");
				this.restartContinuousRecording();
				return;
			}
			
			// Convert to WAV format for Vosk
			const wavBlob = await this.convertToWav(audioBlob);
			console.log(`📊 [VoiceAssistant] WAV blob size: ${wavBlob.size} bytes`);
			
			// Send to node helper for Vosk wake word detection
			const reader = new FileReader();
			reader.onload = () => {
				const audioData = reader.result;
				console.log(`📡 [VoiceAssistant] Sending ${audioData.byteLength} bytes to Vosk for wake word detection...`);
				this.sendSocketNotification("VOSK_WAKE_WORD", { audioData: audioData });
			};
			reader.readAsArrayBuffer(wavBlob);
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Error processing continuous recording:", error);
		}
		
		// Restart continuous recording if still in wake word mode
		this.restartContinuousRecording();
	},

	restartContinuousRecording() {
		if (this.isWakeWordActive && !this.isProcessing) {
			console.log("🔄 [VoiceAssistant] Restarting continuous recording in 500ms...");
			setTimeout(() => {
				if (this.isWakeWordActive && !this.isProcessing) {
					console.log("✅ [VoiceAssistant] Restarting continuous recording now");
					this.startContinuousRecording();
				} else {
					console.log(`⚠️ [VoiceAssistant] Cannot restart: isWakeWordActive=${this.isWakeWordActive}, isProcessing=${this.isProcessing}`);
				}
			}, 500); // Shorter gap between recordings
		} else {
			console.log(`⚠️ [VoiceAssistant] Not restarting: isWakeWordActive=${this.isWakeWordActive}, isProcessing=${this.isProcessing}`);
		}
	},

	stopVoskWakeWordDetection() {
		console.log("🛑 [VoiceAssistant] Stopping Vosk wake word detection...");
		
		this.isWakeWordActive = false;
		this.isListening = false;
		
		if (this.wakeWordInterval) {
			clearTimeout(this.wakeWordInterval);
			this.wakeWordInterval = null;
		}
		
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
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
		console.log("🎤 [VoiceAssistant] Starting command recording...");
		
		// First, stop any ongoing wake word detection
		if (this.isWakeWordActive) {
			console.log("🛑 [VoiceAssistant] Stopping wake word detection for command recording");
			this.stopVoskWakeWordDetection();
			// Wait a moment for cleanup
			await new Promise(resolve => setTimeout(resolve, 500));
		}
		
		if (this.isListening || this.isProcessing) {
			console.log("⚠️ [VoiceAssistant] Still busy after wake word cleanup, forcing stop...");
			this.isListening = false;
			this.isProcessing = false;
			if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
				this.mediaRecorder.stop();
			}
			// Wait for cleanup
			await new Promise(resolve => setTimeout(resolve, 300));
		}
		
		if (!this.audioStream) {
			console.log("❌ [VoiceAssistant] No audio stream available");
			return;
		}

		this.setState("listening");
		this.isListening = true;
		this.audioChunks = [];

		try {
			// Create MediaRecorder for command recording
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
			console.log("✅ [VoiceAssistant] Command recording started successfully");

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
		if (newState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
			setTimeout(() => {
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
					console.log("🔄 [VoiceAssistant] Auto-restarting wake word detection in waiting state");
					this.startVoskWakeWordDetection();
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
		if (!this.config.speechSynthesis) {
			// If speech synthesis is disabled, go straight back to waiting with wake word
			this.setState("waiting");
			this.isProcessing = false;
			setTimeout(() => {
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
					console.log("🔄 [VoiceAssistant] Restarting wake word detection (no TTS)");
					this.startVoskWakeWordDetection();
				}
			}, 1000);
			return;
		}

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
					this.startVoskWakeWordDetection();
				}
			}, 1000);
		};

		speechSynthesis.speak(utterance);
	},

	onWakeWordDetected() {
		console.log("🎯 [VoiceAssistant] Wake word successfully detected!");
		
		// Reset attempt counter on successful detection
		this.wakeWordAttempts = 0;
		
		// Stop wake word detection
		this.stopVoskWakeWordDetection();
		
		// Start command recording with Vosk
		this.startCommandRecording();
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "VOSK_WAKE_WORD":
				if (payload.success) {
					const transcript = payload.transcript.toLowerCase().trim();
					
					// Only log when there's actual speech detected
					if (transcript) {
						console.log(`🗣️ [VoiceAssistant] Continuous audio: "${transcript}"`);
						
						// Check if wake word is in the transcript
						if (transcript.includes(this.config.wakeWord.toLowerCase()) || 
							transcript.includes("mirror") || 
							transcript.includes("hello mirror")) {
							console.log("🎯 [VoiceAssistant] Wake word detected in Vosk transcript!");
							this.onWakeWordDetected();
						}
					}
					// Silence (empty transcript) is normal - don't log anything
				} else if (payload.error) {
					console.log(`⚠️ [VoiceAssistant] Vosk wake word error: ${payload.error}`);
				}
				break;
				
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
						
						// Restart wake word detection
						setTimeout(() => {
							if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
								console.log("🔄 [VoiceAssistant] Restarting wake word detection after empty transcription");
								this.startVoskWakeWordDetection();
							}
						}, 1000);
					}
				} else {
					console.error(`❌ [VoiceAssistant] Vosk error: ${payload.error}`);
					this.setState("waiting");
					this.isProcessing = false;
					this.currentUserInput = "";
					
					// Restart wake word detection
					setTimeout(() => {
						if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
							console.log("🔄 [VoiceAssistant] Restarting wake word detection after Vosk error");
							this.startVoskWakeWordDetection();
						}
					}, 1000);
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
				
				// Restart wake word detection
				setTimeout(() => {
					if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode) {
						console.log("🔄 [VoiceAssistant] Restarting wake word detection after LLM error");
						this.startVoskWakeWordDetection();
					}
				}, 1000);
				break;
		}
	},

	suspend() {
		this.initializationComplete = false;
		
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
		
		// Clean up Vosk wake word detection
		this.stopVoskWakeWordDetection();
		
		if (this.audioStream) {
			this.audioStream.getTracks().forEach(track => track.stop());
		}
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}
	}
}); 