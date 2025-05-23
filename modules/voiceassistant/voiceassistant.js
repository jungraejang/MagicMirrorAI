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
		console.log("🚀 [VoiceAssistant] Module starting (Vosk-only mode)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.isWakeWordActive = false;
		this.wakeWordWorking = false;
		this.conversation = [];
		this.mediaRecorder = null;
		this.audioStream = null;
		this.wakeWordInterval = null;
		this.commandRecordingTimer = null;
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
			// Shorter delay for faster restart
			await new Promise(resolve => setTimeout(resolve, 50));
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
			// Use the same MIME type that was determined to work for command recording
			let mimeType = 'audio/webm'; // Default fallback
			if (this.recordingMimeType) {
				// Use the same format that worked for command recording
				mimeType = this.recordingMimeType;
				console.log(`✅ [VoiceAssistant] Using established MIME type for wake word: ${mimeType}`);
			} else {
				// First time setup - try to find a supported format
				const mimeTypes = [
					'audio/webm;codecs=opus',
					'audio/webm',
					'audio/ogg;codecs=opus'
				];
				
				for (const testType of mimeTypes) {
					if (MediaRecorder.isTypeSupported(testType)) {
						mimeType = testType;
						console.log(`✅ [VoiceAssistant] Using MIME type for wake word: ${mimeType}`);
						break;
					}
				}
			}

			// Create MediaRecorder for continuous listening with optimized settings
			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: mimeType,
				audioBitsPerSecond: 16000 // Lower bitrate for faster processing
			});
			
			// Store format for consistency 
			this.wakeWordMimeType = mimeType;

			this.mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					this.audioChunks.push(event.data);
				}
			};

			this.mediaRecorder.onstop = () => {
				this.processContinuousRecording();
			};

			// Start recording with smaller time slices for faster processing
			this.mediaRecorder.start(500); // 500ms slices for more responsive processing

			// Optimized: shorter chunks for faster wake word detection
			this.wakeWordInterval = setTimeout(() => {
				if (this.isWakeWordActive && this.mediaRecorder && this.mediaRecorder.state === "recording") {
					this.mediaRecorder.stop();
				}
			}, 3000); // 3-second chunks for faster response

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
			const audioBlob = new Blob(this.audioChunks, { type: this.wakeWordMimeType });
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
			console.log("🔄 [VoiceAssistant] Restarting continuous recording in 200ms...");
			setTimeout(() => {
				if (this.isWakeWordActive && !this.isProcessing) {
					console.log("✅ [VoiceAssistant] Restarting continuous recording now");
					this.startContinuousRecording();
				} else {
					console.log(`⚠️ [VoiceAssistant] Cannot restart: isWakeWordActive=${this.isWakeWordActive}, isProcessing=${this.isProcessing}`);
				}
			}, 200); // Faster restart for better responsiveness
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
			await new Promise(resolve => setTimeout(resolve, 300));
		}
		
		// Clear any existing recording state
		this.isListening = false;
		this.isProcessing = true; // Set processing to prevent auto-restart
		
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			console.log("🛑 [VoiceAssistant] Stopping existing recorder");
			this.mediaRecorder.stop();
			await new Promise(resolve => setTimeout(resolve, 200));
		}
		
		if (!this.audioStream) {
			console.log("❌ [VoiceAssistant] No audio stream available");
			this.setState("waiting");
			this.isProcessing = false;
			return;
		}

		console.log("🎙️ [VoiceAssistant] Setting up command recording...");
		this.setState("listening");
		this.isListening = true;
		this.audioChunks = [];

		try {
			// Try different MIME types in order of preference for better compatibility
			const mimeTypes = [
				'audio/wav',
				'audio/webm;codecs=pcm',
				'audio/webm;codecs=opus',
				'audio/ogg;codecs=opus',
				'audio/mp4',
				'audio/webm'
			];
			
			let selectedMimeType = null;
			for (const mimeType of mimeTypes) {
				if (MediaRecorder.isTypeSupported(mimeType)) {
					selectedMimeType = mimeType;
					console.log(`✅ [VoiceAssistant] Using MIME type: ${mimeType}`);
					break;
				}
			}
			
			if (!selectedMimeType) {
				selectedMimeType = 'audio/webm'; // Fallback
				console.log("⚠️ [VoiceAssistant] No supported MIME types found, using fallback");
			}

			// Create MediaRecorder for command recording with compatible format
			this.mediaRecorder = new MediaRecorder(this.audioStream, {
				mimeType: selectedMimeType
			});
			
			// Store the format for later processing
			this.recordingMimeType = selectedMimeType;

			this.mediaRecorder.ondataavailable = (event) => {
				console.log(`📊 [VoiceAssistant] Command audio chunk: ${event.data.size} bytes`);
				if (event.data.size > 0) {
					this.audioChunks.push(event.data);
				}
			};

			this.mediaRecorder.onstop = () => {
				console.log("🔇 [VoiceAssistant] Command recorder stopped, processing...");
				this.processRecording();
			};

			this.mediaRecorder.onerror = (event) => {
				console.error("❌ [VoiceAssistant] MediaRecorder error:", event.error);
				this.setState("waiting");
				this.isProcessing = false;
			};

			// Start recording with time slices for better data collection
			this.mediaRecorder.start(200);
			console.log("✅ [VoiceAssistant] Command recording started successfully");

			// Auto-stop after configured duration
			this.commandRecordingTimer = setTimeout(() => {
				if (this.currentState === "listening" && this.mediaRecorder && this.mediaRecorder.state === "recording") {
					console.log("⏰ [VoiceAssistant] Command recording timeout, stopping...");
					this.stopCommandRecording();
				}
			}, this.config.recordingDuration);

		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start command recording:", error);
			this.setState("waiting");
			this.isProcessing = false;
		}
	},

	stopCommandRecording() {
		if (!this.isListening || !this.mediaRecorder) {
			console.log("⚠️ [VoiceAssistant] No active command recording to stop");
			return;
		}

		console.log("🔇 [VoiceAssistant] Stopping command recording...");
		
		if (this.commandRecordingTimer) {
			clearTimeout(this.commandRecordingTimer);
			this.commandRecordingTimer = null;
		}
		
		this.isListening = false;
		
		if (this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
	},

	async processRecording() {
		console.log("🔄 [VoiceAssistant] Processing recorded audio with Vosk...");
		
		this.setState("processing");
		
		try {
			console.log(`📊 [VoiceAssistant] Command audio chunks collected: ${this.audioChunks.length}`);
			
			if (this.audioChunks.length === 0) {
				console.log("⚠️ [VoiceAssistant] No command audio chunks collected");
				this.setState("waiting");
				this.isProcessing = false;
				return;
			}

			// Create audio blob
			const audioBlob = new Blob(this.audioChunks, { type: this.recordingMimeType });
			console.log(`📊 [VoiceAssistant] Command audio blob size: ${audioBlob.size} bytes`);
			
			if (audioBlob.size === 0) {
				console.log("⚠️ [VoiceAssistant] Empty command audio blob");
				this.setState("waiting");
				this.isProcessing = false;
				return;
			}
			
			// Add delay to ensure audio is complete
			await new Promise(resolve => setTimeout(resolve, 100));
			
			// Handle different audio formats
			console.log(`🎵 [VoiceAssistant] Processing ${this.recordingMimeType} audio`);
			
			// If we got WAV directly, use it as-is
			if (this.recordingMimeType === 'audio/wav') {
				console.log("✅ [VoiceAssistant] Using native WAV format");
				const reader = new FileReader();
				reader.onload = () => {
					const audioData = reader.result;
					console.log(`📡 [VoiceAssistant] Sending ${audioData.byteLength} bytes of WAV data to Vosk...`);
					this.sendSocketNotification("VOSK_TRANSCRIBE", { 
						audioData: audioData,
						isCommand: true,
						originalFormat: 'wav'
					});
				};
				reader.onerror = () => {
					console.error("❌ [VoiceAssistant] FileReader error");
					this.setState("waiting");
					this.isProcessing = false;
				};
				reader.readAsArrayBuffer(audioBlob);
				return;
			}
			
			// Try client-side conversion to WAV first
			let wavBlob;
			try {
				wavBlob = await this.convertToWav(audioBlob);
				console.log(`📊 [VoiceAssistant] Command WAV blob size: ${wavBlob.size} bytes`);
				
				if (wavBlob.size === 0) {
					throw new Error("WAV conversion produced empty file");
				}
				
				// Send converted WAV
				const reader = new FileReader();
				reader.onload = () => {
					const audioData = reader.result;
					console.log(`📡 [VoiceAssistant] Sending ${audioData.byteLength} bytes of converted WAV to Vosk...`);
					this.sendSocketNotification("VOSK_TRANSCRIBE", { 
						audioData: audioData,
						isCommand: true,
						originalFormat: 'wav'
					});
				};
				reader.onerror = () => {
					console.error("❌ [VoiceAssistant] FileReader error");
					this.setState("waiting");
					this.isProcessing = false;
				};
				reader.readAsArrayBuffer(wavBlob);
				
			} catch (conversionError) {
				console.error("❌ [VoiceAssistant] Client-side conversion failed:", conversionError.message);
				console.log("🔄 [VoiceAssistant] Trying server-side conversion fallback...");
				
				// Fallback: send original audio to server for conversion
				const reader = new FileReader();
				reader.onload = () => {
					const audioData = reader.result;
					console.log(`📡 [VoiceAssistant] Sending ${audioData.byteLength} bytes of ${this.recordingMimeType} to server for conversion...`);
					this.sendSocketNotification("VOSK_TRANSCRIBE", { 
						audioData: audioData,
						isCommand: true,
						originalFormat: this.recordingMimeType,
						needsConversion: true
					});
				};
				reader.onerror = () => {
					console.error("❌ [VoiceAssistant] FileReader error on fallback");
					this.setState("waiting");
					this.isProcessing = false;
					
					// Show error message to user
					this.sendSocketNotification("SPEECH_ERROR", {
						error: "Audio processing failed",
						userMessage: "Sorry, I couldn't process your audio. Please try again."
					});
				};
				reader.readAsArrayBuffer(audioBlob);
			}
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Error processing command recording:", error);
			this.setState("waiting");
			this.isProcessing = false;
		}
	},

	async convertToWav(webmBlob) {
		console.log("🔄 [VoiceAssistant] Converting WebM to WAV...");
		
		// Create audio context with better error handling
		let audioContext;
		try {
			audioContext = new (window.AudioContext || window.webkitAudioContext)({
				sampleRate: 16000
			});
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to create audio context:", error);
			throw new Error("Audio context creation failed");
		}
		
		try {
			// Wait for audio context to be ready
			if (audioContext.state === 'suspended') {
				await audioContext.resume();
			}
			
			// Decode audio data with timeout
			console.log("📊 [VoiceAssistant] Decoding WebM audio...");
			const arrayBuffer = await webmBlob.arrayBuffer();
			console.log(`📊 [VoiceAssistant] WebM buffer size: ${arrayBuffer.byteLength} bytes`);
			
			if (arrayBuffer.byteLength === 0) {
				throw new Error("Empty audio buffer");
			}
			
			// Decode with timeout protection
			const audioBuffer = await Promise.race([
				audioContext.decodeAudioData(arrayBuffer),
				new Promise((_, reject) => 
					setTimeout(() => reject(new Error("Decode timeout")), 5000)
				)
			]);
			
			console.log(`📊 [VoiceAssistant] Decoded audio: ${audioBuffer.duration}s, ${audioBuffer.sampleRate}Hz`);
			
			// Resample to 16kHz for Vosk
			const targetSampleRate = 16000;
			const resampledBuffer = await this.resampleAudio(audioBuffer, targetSampleRate);
			
			// Get PCM data
			const pcmData = resampledBuffer.getChannelData(0);
			console.log(`📊 [VoiceAssistant] PCM data length: ${pcmData.length} samples`);
			
			if (pcmData.length === 0) {
				throw new Error("No audio data after conversion");
			}
			
			// Create WAV file
			const wavBuffer = this.createWavFile(pcmData, targetSampleRate);
			console.log(`📊 [VoiceAssistant] WAV buffer size: ${wavBuffer.byteLength} bytes`);
			
			return new Blob([wavBuffer], { type: 'audio/wav' });
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] WAV conversion failed:", error.message);
			throw error;
		} finally {
			// Clean up audio context
			if (audioContext && audioContext.state !== 'closed') {
				try {
					await audioContext.close();
				} catch (closeError) {
					console.warn("⚠️ [VoiceAssistant] Audio context close error:", closeError);
				}
			}
		}
	},

	async resampleAudio(audioBuffer, targetSampleRate) {
		console.log(`🔄 [VoiceAssistant] Resampling from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
		
		const originalSampleRate = audioBuffer.sampleRate;
		
		if (originalSampleRate === targetSampleRate) {
			console.log("✅ [VoiceAssistant] Sample rates match, no resampling needed");
			return audioBuffer;
		}
		
		const ratio = originalSampleRate / targetSampleRate;
		const targetLength = Math.round(audioBuffer.length / ratio);
		
		console.log(`📊 [VoiceAssistant] Resampling: ${audioBuffer.length} → ${targetLength} samples`);
		
		try {
			const offlineContext = new OfflineAudioContext(1, targetLength, targetSampleRate);
			const bufferSource = offlineContext.createBufferSource();
			bufferSource.buffer = audioBuffer;
			bufferSource.connect(offlineContext.destination);
			bufferSource.start(0);
			
			const resampledBuffer = await Promise.race([
				offlineContext.startRendering(),
				new Promise((_, reject) => 
					setTimeout(() => reject(new Error("Resample timeout")), 3000)
				)
			]);
			
			console.log("✅ [VoiceAssistant] Resampling completed");
			return resampledBuffer;
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Resampling failed:", error);
			throw error;
		}
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
		
		// Only restart wake word detection when entering waiting state from responding/processing
		// Don't restart if we just finished command recording or if processing is still active
		if (newState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
			setTimeout(() => {
				// Double-check conditions before restarting
				if (this.currentState === "waiting" && 
					!this.isWakeWordActive && 
					!this.manualMode && 
					!this.isProcessing &&
					!this.isListening) {
					console.log("🔄 [VoiceAssistant] Auto-restarting wake word detection in waiting state");
					this.startVoskWakeWordDetection();
				} else {
					console.log(`⚠️ [VoiceAssistant] Skipping wake word restart: isWakeWordActive=${this.isWakeWordActive}, isProcessing=${this.isProcessing}, isListening=${this.isListening}`);
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
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
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
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
					console.log("🔄 [VoiceAssistant] Restarting wake word detection after speech");
					this.startVoskWakeWordDetection();
				}
			}, 1000);
		};

		utterance.onerror = () => {
			console.error("❌ [VoiceAssistant] Speech synthesis error");
			this.setState("waiting");
			this.isProcessing = false;
			
			// Restart wake word detection after error
			setTimeout(() => {
				if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
					console.log("🔄 [VoiceAssistant] Restarting wake word detection after speech error");
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
						
						// Enhanced wake word detection with multiple triggers
						if (transcript.includes(this.config.wakeWord.toLowerCase()) || 
							transcript.includes("mirror") || 
							transcript.includes("hello mirror") ||
							transcript.includes("hello") ||
							transcript.includes("hey mirror") ||
							transcript.includes("ok mirror")) {
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
						// Keep isProcessing true as we're now processing with LLM
						this.processUserInput(payload.transcript);
					} else {
						console.log("⚠️ [VoiceAssistant] Empty transcription, returning to waiting");
						this.setState("waiting");
						this.isProcessing = false;
						this.currentUserInput = "";
						
						// Restart wake word detection after short delay
						setTimeout(() => {
							if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
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
					
					// Restart wake word detection after error
					setTimeout(() => {
						if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
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
				
				// Show user-friendly error message if provided
				if (payload.userMessage && this.config.speechSynthesis) {
					this.speak(payload.userMessage);
				} else {
					// Restart wake word detection after LLM error
					setTimeout(() => {
						if (this.currentState === "waiting" && !this.isWakeWordActive && !this.manualMode && !this.isProcessing) {
							console.log("🔄 [VoiceAssistant] Restarting wake word detection after LLM error");
							this.startVoskWakeWordDetection();
						}
					}, 1000);
				}
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
		if (this.commandRecordingTimer) {
			clearTimeout(this.commandRecordingTimer);
		}
	}
}); 