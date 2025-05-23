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
		
		this.isListening = false;
		this.isProcessing = false;
		this.conversation = [];
		this.recognition = null;
		this.wakeWordRecognition = null;
		this.displayTimer = null;
		this.currentState = "waiting"; // waiting, listening, processing, responding
		
		this.initSpeechRecognition();
		this.startWakeWordDetection();
		
		// Send config to node helper
		this.sendSocketNotification("CONFIG", this.config);
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

		// Status indicator
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

		// Conversation display
		if (this.conversation.length > 0) {
			const conversationDiv = document.createElement("div");
			conversationDiv.className = "conversation";

			// Show last few exchanges
			const recent = this.conversation.slice(-2);
			recent.forEach(exchange => {
				if (exchange.user) {
					const userDiv = document.createElement("div");
					userDiv.className = "user-message";
					userDiv.innerHTML = `<i class="fas fa-user"></i> ${exchange.user}`;
					conversationDiv.appendChild(userDiv);
				}
				
				if (exchange.assistant) {
					const assistantDiv = document.createElement("div");
					assistantDiv.className = "assistant-message";
					assistantDiv.innerHTML = `<i class="fas fa-robot"></i> ${exchange.assistant}`;
					conversationDiv.appendChild(assistantDiv);
				}
			});

			wrapper.appendChild(conversationDiv);
		}

		return wrapper;
	},

	initSpeechRecognition() {
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			Log.error("Speech recognition not supported");
			this.sendNotification("SHOW_ALERT", {
				type: "notification",
				message: "Speech recognition not supported in this browser"
			});
			return;
		}

		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		
		// Wake word detection
		this.wakeWordRecognition = new SpeechRecognition();
		this.wakeWordRecognition.continuous = true;
		this.wakeWordRecognition.interimResults = false;
		this.wakeWordRecognition.lang = this.config.language;

		this.wakeWordRecognition.onresult = (event) => {
			const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
			
			if (this.config.debugMode) {
				Log.info(`Wake word detection heard: "${transcript}"`);
			}

			if (transcript.includes(this.config.wakeWord.toLowerCase())) {
				Log.info("Wake word detected!");
				this.startListening();
			}
		};

		this.wakeWordRecognition.onerror = (event) => {
			if (this.config.debugMode) {
				Log.error("Wake word recognition error:", event.error);
			}
		};

		// Main speech recognition for commands
		this.recognition = new SpeechRecognition();
		this.recognition.continuous = false;
		this.recognition.interimResults = false;
		this.recognition.lang = this.config.language;

		this.recognition.onresult = (event) => {
			const transcript = event.results[0][0].transcript.trim();
			Log.info(`Speech recognized: "${transcript}"`);
			this.processUserInput(transcript);
		};

		this.recognition.onerror = (event) => {
			Log.error("Speech recognition error:", event.error);
			this.setState("waiting");
			this.startWakeWordDetection();
		};

		this.recognition.onend = () => {
			if (this.currentState === "listening") {
				// If we're still in listening mode, restart listening
				setTimeout(() => {
					if (this.currentState === "listening") {
						this.recognition.start();
					}
				}, 100);
			}
		};
	},

	startWakeWordDetection() {
		if (this.wakeWordRecognition && this.currentState === "waiting") {
			try {
				this.wakeWordRecognition.start();
			} catch (error) {
				if (this.config.debugMode) {
					Log.error("Error starting wake word detection:", error);
				}
				// Restart after a delay
				setTimeout(() => this.startWakeWordDetection(), 1000);
			}
		}
	},

	startListening() {
		if (this.isListening || this.isProcessing) return;

		this.wakeWordRecognition.stop();
		this.setState("listening");
		this.isListening = true;

		try {
			this.recognition.start();
		} catch (error) {
			Log.error("Error starting speech recognition:", error);
			this.setState("waiting");
			this.startWakeWordDetection();
		}

		// Auto-timeout after 10 seconds
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
		setTimeout(() => this.startWakeWordDetection(), 500);
	},

	processUserInput(userInput) {
		this.setState("processing");
		this.isListening = false;
		this.isProcessing = true;

		// Add to conversation history
		const currentExchange = { user: userInput };
		
		// Send to node helper for LLM processing
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
			this.startWakeWordDetection();
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
			setTimeout(() => this.startWakeWordDetection(), 500);
		};

		speechSynthesis.speak(utterance);
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "SPEECH_RESPONSE":
				this.setState("responding");
				
				// Add to conversation history
				const exchange = {
					user: payload.userInput,
					assistant: payload.response
				};
				
				this.conversation.push(exchange);
				
				// Keep only recent conversation
				if (this.conversation.length > this.config.maxConversationHistory) {
					this.conversation = this.conversation.slice(-this.config.maxConversationHistory);
				}

				this.updateDom(300);
				this.speak(payload.response);
				break;

			case "SPEECH_ERROR":
				Log.error("Speech processing error:", payload);
				this.setState("waiting");
				this.isProcessing = false;
				this.startWakeWordDetection();
				break;
		}
	},

	notificationReceived(notification, payload, sender) {
		if (notification === "VOICE_ASSISTANT_WAKE") {
			this.startListening();
		} else if (notification === "VOICE_ASSISTANT_SLEEP") {
			this.stopListening();
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
	},

	resume() {
		this.startWakeWordDetection();
	}
}); 