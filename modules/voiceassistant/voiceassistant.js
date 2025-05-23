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
		console.log("🚀 [VoiceAssistant] Module starting...");
		
		this.isListening = false;
		this.isProcessing = false;
		this.conversation = [];
		this.recognition = null;
		this.wakeWordRecognition = null;
		this.displayTimer = null;
		this.currentState = "waiting"; // waiting, listening, processing, responding
		
		// Test microphone permissions first
		this.testMicrophoneAccess();
		
		this.initSpeechRecognition();
		this.startWakeWordDetection();
		
		// Send config to node helper
		this.sendSocketNotification("CONFIG", this.config);
		console.log("📡 [VoiceAssistant] Config sent to node helper");
	},

	async testMicrophoneAccess() {
		console.log("🎤 [VoiceAssistant] Testing microphone access...");
		
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			console.log("✅ [VoiceAssistant] Microphone access granted!");
			console.log("🎤 [VoiceAssistant] Audio tracks:", stream.getAudioTracks());
			
			// Stop the stream
			stream.getTracks().forEach(track => track.stop());
			
			return true;
		} catch (error) {
			console.error("❌ [VoiceAssistant] Microphone access denied:", error.name, error.message);
			console.error("Full error:", error);
			
			// Show user-friendly error
			this.sendNotification("SHOW_ALERT", {
				type: "notification",
				message: `Microphone error: ${error.message}. Please allow microphone access.`
			});
			
			return false;
		}
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
		console.log("🔧 [VoiceAssistant] Initializing speech recognition...");
		
		if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
			console.error("❌ [VoiceAssistant] Speech recognition not supported");
			this.sendNotification("SHOW_ALERT", {
				type: "notification",
				message: "Speech recognition not supported in this browser"
			});
			return;
		}

		console.log("✅ [VoiceAssistant] Speech recognition supported");
		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		
		// Wake word detection
		console.log("🎤 [VoiceAssistant] Setting up wake word detection...");
		this.wakeWordRecognition = new SpeechRecognition();
		this.wakeWordRecognition.continuous = true;
		this.wakeWordRecognition.interimResults = false;
		this.wakeWordRecognition.lang = this.config.language;

		this.wakeWordRecognition.onstart = () => {
			console.log("🟢 [VoiceAssistant] Wake word detection started");
		};

		this.wakeWordRecognition.onresult = (event) => {
			const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
			
			console.log(`🗣️ [VoiceAssistant] Wake word detection heard: "${transcript}"`);
			
			if (transcript.includes(this.config.wakeWord.toLowerCase())) {
				console.log("🎯 [VoiceAssistant] Wake word detected!");
				this.startListening();
			} else if (this.config.debugMode) {
				console.log(`🔍 [VoiceAssistant] Not wake word (looking for: "${this.config.wakeWord}")`);
			}
		};

		this.wakeWordRecognition.onerror = (event) => {
			console.error(`❌ [VoiceAssistant] Wake word recognition error: ${event.error}`);
			console.error("Full error details:", event);
			
			// Try to restart after network errors
			if (event.error === 'network') {
				console.log("🔄 [VoiceAssistant] Network error - will retry in 5 seconds...");
				setTimeout(() => {
					if (this.currentState === "waiting") {
						console.log("🔄 [VoiceAssistant] Retrying wake word detection...");
						this.startWakeWordDetection();
					}
				}, 5000);
			}
		};

		this.wakeWordRecognition.onend = () => {
			console.log("🔴 [VoiceAssistant] Wake word detection ended");
			if (this.currentState === "waiting") {
				console.log("🔄 [VoiceAssistant] Restarting wake word detection...");
				setTimeout(() => this.startWakeWordDetection(), 1000);
			}
		};

		// Main speech recognition for commands
		console.log("🎤 [VoiceAssistant] Setting up main speech recognition...");
		this.recognition = new SpeechRecognition();
		this.recognition.continuous = false;
		this.recognition.interimResults = false;
		this.recognition.lang = this.config.language;

		this.recognition.onstart = () => {
			console.log("🟢 [VoiceAssistant] Main recognition started - speak now!");
		};

		this.recognition.onresult = (event) => {
			const transcript = event.results[0][0].transcript.trim();
			console.log(`🗣️ [VoiceAssistant] Speech recognized: "${transcript}"`);
			this.processUserInput(transcript);
		};

		this.recognition.onerror = (event) => {
			console.error(`❌ [VoiceAssistant] Speech recognition error: ${event.error}`);
			console.error("Full error details:", event);
			this.setState("waiting");
			this.startWakeWordDetection();
		};

		this.recognition.onend = () => {
			console.log("🔴 [VoiceAssistant] Main recognition ended");
			if (this.currentState === "listening") {
				// If we're still in listening mode, restart listening
				setTimeout(() => {
					if (this.currentState === "listening") {
						console.log("🔄 [VoiceAssistant] Restarting main recognition...");
						this.recognition.start();
					}
				}, 100);
			}
		};
		
		console.log("✅ [VoiceAssistant] Speech recognition setup complete");
	},

	startWakeWordDetection() {
		console.log("🚀 [VoiceAssistant] Attempting to start wake word detection...");
		console.log(`🚀 [VoiceAssistant] Current state: ${this.currentState}`);
		
		if (this.wakeWordRecognition && this.currentState === "waiting") {
			try {
				console.log("🎯 [VoiceAssistant] Starting wake word recognition service...");
				this.wakeWordRecognition.start();
			} catch (error) {
				console.error("❌ [VoiceAssistant] Error starting wake word detection:", error);
				// Restart after a delay
				setTimeout(() => {
					console.log("🔄 [VoiceAssistant] Retrying wake word detection after error...");
					this.startWakeWordDetection();
				}, 1000);
			}
		} else {
			console.log(`⚠️ [VoiceAssistant] Cannot start wake word detection - wakeWordRecognition: ${!!this.wakeWordRecognition}, state: ${this.currentState}`);
		}
	},

	startListening() {
		console.log("🎤 [VoiceAssistant] Starting listening mode...");
		
		if (this.isListening || this.isProcessing) {
			console.log(`⚠️ [VoiceAssistant] Already busy - isListening: ${this.isListening}, isProcessing: ${this.isProcessing}`);
			return;
		}

		console.log("🛑 [VoiceAssistant] Stopping wake word detection...");
		this.wakeWordRecognition.stop();
		this.setState("listening");
		this.isListening = true;

		try {
			console.log("🎯 [VoiceAssistant] Starting main recognition for user input...");
			this.recognition.start();
		} catch (error) {
			console.error("❌ [VoiceAssistant] Error starting speech recognition:", error);
			this.setState("waiting");
			this.startWakeWordDetection();
		}

		// Auto-timeout after 10 seconds
		setTimeout(() => {
			if (this.currentState === "listening") {
				console.log("⏰ [VoiceAssistant] Listening timeout - stopping...");
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