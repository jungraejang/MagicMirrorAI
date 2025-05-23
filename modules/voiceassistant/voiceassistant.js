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
		debugMode: false
	},

	requiresVersion: "2.1.0",

	start() {
		Log.info(`Starting module: ${this.name}`);
		console.log("🚀 [VoiceAssistant] Module starting (simple version)...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.conversation = [];
		this.recognition = null;
		this.wakeWordRecognition = null;
		this.displayTimer = null;
		this.currentState = "waiting";
		
		// Send config to node helper
		this.sendSocketNotification("CONFIG", this.config);
		console.log("📡 [VoiceAssistant] Config sent to node helper");
		
		// Initialize speech recognition WITHOUT auto-retry
		setTimeout(() => {
			this.initSpeechRecognition();
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

		switch (this.currentState) {
			case "waiting":
				statusIcon.className = "fas fa-microphone-slash";
				statusText.innerHTML = `Say "${this.config.wakeWord}" to start`;
				break;
			case "listening":
				statusIcon.className = "fas fa-microphone pulse";
				statusText.innerHTML = "Listening...";
				break;
			case "processing":
				statusIcon.className = "fas fa-brain spin";
				statusText.innerHTML = "Thinking...";
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

	initSpeechRecognition() {
		console.log("🔧 [VoiceAssistant] Initializing speech recognition (simple)...");
		
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			console.error("❌ [VoiceAssistant] Speech recognition not supported");
			return;
		}

		console.log("✅ [VoiceAssistant] Speech recognition supported");
		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		
		// Simple wake word detection - NO AUTO RETRY
		this.wakeWordRecognition = new SpeechRecognition();
		this.wakeWordRecognition.continuous = true;
		this.wakeWordRecognition.interimResults = false;
		this.wakeWordRecognition.lang = this.config.language;

		this.wakeWordRecognition.onresult = (event) => {
			const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
			console.log(`🗣️ [VoiceAssistant] Heard: "${transcript}"`);
			
			if (transcript.includes(this.config.wakeWord.toLowerCase())) {
				console.log("🎯 [VoiceAssistant] Wake word detected!");
				this.startListening();
			}
		};

		this.wakeWordRecognition.onerror = (event) => {
			console.error(`❌ [VoiceAssistant] Error: ${event.error}`);
			// NO AUTOMATIC RETRY - just log the error
		};

		// Main speech recognition
		this.recognition = new SpeechRecognition();
		this.recognition.continuous = false;
		this.recognition.interimResults = false;
		this.recognition.lang = this.config.language;

		this.recognition.onresult = (event) => {
			const transcript = event.results[0][0].transcript.trim();
			console.log(`🗣️ [VoiceAssistant] Command: "${transcript}"`);
			this.processUserInput(transcript);
		};

		this.recognition.onerror = (event) => {
			console.error(`❌ [VoiceAssistant] Command error: ${event.error}`);
			this.setState("waiting");
		};

		// Try to start wake word detection ONCE
		this.tryStartWakeWord();
	},

	tryStartWakeWord() {
		if (!this.wakeWordRecognition) return;
		
		try {
			console.log("🎯 [VoiceAssistant] Starting wake word detection...");
			this.wakeWordRecognition.start();
			console.log("✅ [VoiceAssistant] Wake word detection started");
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start wake word detection:", error);
			// Don't retry automatically - user can refresh page
		}
	},

	startListening() {
		if (this.isListening || this.isProcessing) return;

		console.log("🎤 [VoiceAssistant] Starting to listen for command...");
		
		if (this.wakeWordRecognition) {
			this.wakeWordRecognition.stop();
		}
		
		this.setState("listening");
		this.isListening = true;

		try {
			this.recognition.start();
		} catch (error) {
			console.error("❌ [VoiceAssistant] Failed to start listening:", error);
			this.setState("waiting");
		}

		// Timeout after 10 seconds
		setTimeout(() => {
			if (this.currentState === "listening") {
				this.stopListening();
			}
		}, 10000);
	},

	stopListening() {
		this.isListening = false;
		if (this.recognition) {
			this.recognition.stop();
		}
		this.setState("waiting");
	},

	processUserInput(userInput) {
		this.setState("processing");
		this.isListening = false;
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
		if (this.recognition) {
			this.recognition.stop();
		}
		if (this.wakeWordRecognition) {
			this.wakeWordRecognition.stop();
		}
		if (this.displayTimer) {
			clearTimeout(this.displayTimer);
		}
	}
}); 