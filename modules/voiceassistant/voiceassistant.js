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
		useVosk: true,  // Use Vosk instead of Web Speech API
		recordingDuration: 5000  // Recording duration in milliseconds
	},

	requiresVersion: "2.1.0",

	start() {
		Log.info(`Starting module: ${this.name}`);
		console.log("🚀 [VoiceAssistant] Module starting (Vosk version)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.conversation = [];
		this.mediaRecorder = null;
		this.audioStream = null;
		this.displayTimer = null;
		this.currentState = "waiting";
		this.audioChunks = [];
		
		// Send config to node helper
		this.sendSocketNotification("CONFIG", this.config);
		console.log("📡 [VoiceAssistant] Config sent to node helper");
		
		// Initialize audio recording
		setTimeout(() => {
			this.initAudioRecording();
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

		// Add click handler for click-to-talk
		statusDiv.style.cursor = "pointer";
		statusDiv.onclick = () => {
			if (this.currentState === "waiting") {
				this.startRecording();
			} else if (this.currentState === "listening") {
				this.stopRecording();
			}
		};

		switch (this.currentState) {
			case "waiting":
				statusIcon.className = "fas fa-microphone";
				statusText.innerHTML = "Click to talk (Vosk)";
				break;
			case "listening":
				statusIcon.className = "fas fa-microphone pulse";
				statusText.innerHTML = "Recording... (click to stop)";
				break;
			case "processing":
				statusIcon.className = "fas fa-brain spin";
				statusText.innerHTML = "Processing...";
				break;
			case "responding":
				statusIcon.className = "fas fa-comment-dots";
				statusText.innerHTML = "Responding...";
				break;
		}

		statusDiv.appendChild(statusIcon);
		statusDiv.appendChild(statusText);
		wrapper.appendChild(statusDiv);

		return wrapper;
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
			
			console.log("✅ [VoiceAssistant] Microphone access granted");
			console.log("🎙️ [VoiceAssistant] Vosk audio recording ready");
			
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to access microphone:", error);
			this.currentState = "error";
			this.updateDom();
		}
	},

	async startRecording() {
		if (this.isListening || this.isProcessing || !this.audioStream) return;

		console.log("🎤 [VoiceAssistant] Starting audio recording...");
		
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
					this.stopRecording();
				}
			}, this.config.recordingDuration);

		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start recording:", error);
			this.setState("waiting");
		}
	},

	stopRecording() {
		if (!this.isListening || !this.mediaRecorder) return;

		console.log("🔇 [VoiceAssistant] Stopping audio recording...");
		
		this.isListening = false;
		
		if (this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
	},

	async processRecording() {
		console.log("🔄 [VoiceAssistant] Processing recorded audio...");
		
		this.setState("processing");
		
		try {
			// Create audio blob
			const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
			
			// Convert to WAV format for Vosk
			const wavBlob = await this.convertToWav(audioBlob);
			
			// Send to node helper for Vosk transcription
			const reader = new FileReader();
			reader.onload = () => {
				const audioData = reader.result;
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
		
		// Decode audio data
		const arrayBuffer = await webmBlob.arrayBuffer();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
		
		// Get PCM data
		const pcmData = audioBuffer.getChannelData(0);
		
		// Create WAV file
		const wavBuffer = this.createWavFile(pcmData, audioBuffer.sampleRate);
		
		return new Blob([wavBuffer], { type: 'audio/wav' });
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
		};

		speechSynthesis.speak(utterance);
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "VOSK_TRANSCRIPTION":
				if (payload.success) {
					console.log(`🗣️ [VoiceAssistant] Vosk heard: "${payload.transcript}"`);
					this.processUserInput(payload.transcript);
				} else {
					console.error(`❌ [VoiceAssistant] Vosk error: ${payload.error}`);
					this.setState("waiting");
					this.isProcessing = false;
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
				break;
		}
	},

	suspend() {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
		if (this.audioStream) {
			this.audioStream.getTracks().forEach(track => track.stop());
		}
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}
	}
}); 