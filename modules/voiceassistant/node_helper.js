const NodeHelper = require("node_helper");
const axios = require("axios");
const Log = require("logger");

module.exports = NodeHelper.create({
	
	start() {
		console.log(`🚀 [${this.name}] Node helper started`);
		this.config = {};
		this.conversationHistory = [];
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "CONFIG":
				this.config = payload;
				console.log(`⚙️ [${this.name}] Config received:`, this.config);
				break;
				
			case "PROCESS_SPEECH":
				this.processLLMRequest(payload.userInput, payload.conversation);
				break;

			case "VOSK_TRANSCRIBE":
				this.transcribeWithVosk(payload.audioData);
				break;
		}
	},

	async transcribeWithVosk(audioData) {
		try {
			console.log(`🎙️ [${this.name}] Sending audio to Vosk for transcription...`);
			
			const voskUrl = "http://localhost:5000/transcribe";
			
			const response = await axios.post(voskUrl, audioData, {
				headers: {
					'Content-Type': 'audio/wav',
				},
				timeout: 10000
			});

			if (response.data.success) {
				const transcript = response.data.text.trim();
				console.log(`🗣️ [${this.name}] Vosk transcribed: "${transcript}"`);
				
				if (transcript) {
					this.sendSocketNotification("VOSK_TRANSCRIPTION", {
						success: true,
						transcript: transcript
					});
				} else {
					this.sendSocketNotification("VOSK_TRANSCRIPTION", {
						success: false,
						error: "No speech detected"
					});
				}
			} else {
				console.error(`❌ [${this.name}] Vosk transcription failed:`, response.data.error);
				this.sendSocketNotification("VOSK_TRANSCRIPTION", {
					success: false,
					error: response.data.error
				});
			}

		} catch (error) {
			console.error(`❌ [${this.name}] Vosk transcription error:`, error.message);
			this.sendSocketNotification("VOSK_TRANSCRIPTION", {
				success: false,
				error: `Vosk service error: ${error.message}`
			});
		}
	},

	async processLLMRequest(userInput, conversation) {
		try {
			console.log(`🧠 [${this.name}] Processing: "${userInput}"`);

			// Build conversation context
			const messages = [
				{
					role: "system",
					content: this.config.systemPrompt || "You are a helpful voice assistant."
				}
			];

			// Add conversation history
			if (conversation && conversation.length > 0) {
				conversation.forEach(exchange => {
					messages.push({ role: "user", content: exchange.user });
					messages.push({ role: "assistant", content: exchange.assistant });
				});
			}

			// Add current user input
			messages.push({ role: "user", content: userInput });

			const requestData = {
				model: "local-model",
				messages: messages,
				temperature: 0.7,
				max_tokens: 50
			};

			console.log(`📡 [${this.name}] Sending to LLM...`);

			const response = await axios.post(this.config.llmEndpoint, requestData, {
				headers: {
					'Content-Type': 'application/json',
				},
				timeout: 30000
			});

			if (response.data && response.data.choices && response.data.choices[0]) {
				let assistantResponse = response.data.choices[0].message.content.trim();
				
				// Clean up response for speech synthesis
				assistantResponse = this.cleanTextForSpeech(assistantResponse);
				
				console.log(`🤖 [${this.name}] LLM Response: "${assistantResponse}"`);
				
				this.sendSocketNotification("SPEECH_RESPONSE", {
					userInput: userInput,
					response: assistantResponse
				});
			} else {
				throw new Error("Invalid response format from LLM");
			}

		} catch (error) {
			console.error(`❌ [${this.name}] LLM Error:`, error.message);
			
			let errorMessage = "I'm sorry, I'm having trouble connecting to my brain right now.";
			
			if (error.code === 'ECONNREFUSED') {
				errorMessage = "I can't reach the language model. Is it running?";
			} else if (error.code === 'ETIMEDOUT') {
				errorMessage = "The language model is taking too long to respond.";
			}

			this.sendSocketNotification("SPEECH_ERROR", {
				error: error.message,
				userMessage: errorMessage
			});
		}
	},

	cleanTextForSpeech(text) {
		// Remove thinking tags and content (multiple patterns)
		text = text.replace(/<think>.*?<\/think>/gs, '');
		text = text.replace(/<thinking>.*?<\/thinking>/gs, '');
		text = text.replace(/<reason>.*?<\/reason>/gs, '');
		text = text.replace(/<reasoning>.*?<\/reasoning>/gs, '');
		text = text.replace(/\[thinking\].*?\[\/thinking\]/gs, '');
		text = text.replace(/\*thinking\*.*?\*\/thinking\*/gs, '');
		text = text.replace(/\*\*thinking\*\*.*?\*\*\/thinking\*\*/gs, '');
		
		// Remove other common LLM artifacts
		text = text.replace(/Let me think.*?[.!?]/gi, '');
		text = text.replace(/I need to.*?[.!?]/gi, '');
		text = text.replace(/First.*?[.!?]/gi, '');
		text = text.replace(/Actually.*?[.!?]/gi, '');
		
		// Remove markdown formatting
		text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // Bold
		text = text.replace(/\*(.*?)\*/g, '$1'); // Italic
		text = text.replace(/`(.*?)`/g, '$1'); // Code
		text = text.replace(/#{1,6}\s/g, ''); // Headers
		
		// Remove special characters that might interfere with speech
		text = text.replace(/[#*_`]/g, '');
		
		// Replace URLs with "link"
		text = text.replace(/https?:\/\/[^\s]+/g, 'link');
		
		// Clean up extra whitespace and normalize
		text = text.replace(/\s+/g, ' ').trim();
		
		// Remove empty lines
		text = text.replace(/\n\s*\n/g, '\n');
		
		// Limit to first 2 sentences for brevity
		const sentences = text.split(/[.!?]+/);
		if (sentences.length > 2) {
			text = sentences.slice(0, 2).join('. ').trim();
			if (text && !text.match(/[.!?]$/)) {
				text += '.';
			}
		}
		
		return text;
	},

	// Helper method to check if LLM endpoint is accessible
	async testLLMConnection() {
		try {
			const { default: fetch } = await import('undici');
			const response = await fetch(this.config.llmEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: "test",
					messages: [{ role: "user", content: "Hello" }],
					max_tokens: 1
				})
			});
			
			return response.ok;
		} catch (error) {
			Log.error("LLM connection test failed:", error);
			return false;
		}
	}
}); 