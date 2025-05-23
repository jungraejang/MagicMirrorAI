const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
	
	start() {
		Log.info(`Starting node helper for: ${this.name}`);
		this.config = {};
		this.conversationHistory = [];
	},

	socketNotificationReceived(notification, payload) {
		switch (notification) {
			case "CONFIG":
				this.config = payload;
				Log.info(`Voice Assistant configured with LLM endpoint: ${this.config.llmEndpoint}`);
				break;
				
			case "PROCESS_SPEECH":
				this.processUserSpeech(payload.userInput, payload.conversation);
				break;
		}
	},

	async processUserSpeech(userInput, conversation) {
		try {
			Log.info(`Processing user speech: "${userInput}"`);
			
			// Build conversation context for LLM
			const messages = this.buildConversationMessages(userInput, conversation);
			
			// Send request to LLM
			const response = await this.queryLLM(messages);
			
			// Send response back to frontend
			this.sendSocketNotification("SPEECH_RESPONSE", {
				userInput: userInput,
				response: response
			});
			
		} catch (error) {
			Log.error("Error processing speech:", error);
			this.sendSocketNotification("SPEECH_ERROR", {
				error: error.message,
				userInput: userInput
			});
		}
	},

	buildConversationMessages(userInput, conversation) {
		const messages = [];
		
		// Add system prompt
		messages.push({
			role: "system",
			content: this.config.systemPrompt || "You are a helpful voice assistant for a smart mirror. Keep responses concise and conversational."
		});
		
		// Add conversation history
		conversation.forEach(exchange => {
			if (exchange.user) {
				messages.push({
					role: "user",
					content: exchange.user
				});
			}
			if (exchange.assistant) {
				messages.push({
					role: "assistant",
					content: exchange.assistant
				});
			}
		});
		
		// Add current user input
		messages.push({
			role: "user",
			content: userInput
		});
		
		return messages;
	},

	async queryLLM(messages) {
		const { default: fetch } = await import('undici');
		
		const requestBody = {
			model: "gpt-3.5-turbo", // This can be any model name, local LLMs often ignore this
			messages: messages,
			max_tokens: 150,
			temperature: 0.7,
			stream: false
		};

		const response = await fetch(this.config.llmEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		
		if (!data.choices || !data.choices[0] || !data.choices[0].message) {
			throw new Error("Invalid response format from LLM");
		}

		let assistantResponse = data.choices[0].message.content.trim();
		
		// Clean up response for voice synthesis
		assistantResponse = this.cleanResponseForSpeech(assistantResponse);
		
		return assistantResponse;
	},

	cleanResponseForSpeech(text) {
		// Remove markdown formatting
		text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold
		text = text.replace(/\*(.*?)\*/g, '$1'); // Remove italics
		text = text.replace(/`(.*?)`/g, '$1'); // Remove code blocks
		text = text.replace(/#{1,6}\s/g, ''); // Remove headers
		text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Remove links, keep text
		
		// Remove excessive punctuation that might affect speech
		text = text.replace(/\.{2,}/g, '.'); // Multiple dots to single
		text = text.replace(/!{2,}/g, '!'); // Multiple exclamations to single
		text = text.replace(/\?{2,}/g, '?'); // Multiple questions to single
		
		// Replace some common abbreviations for better speech
		text = text.replace(/\bw\//g, 'with ');
		text = text.replace(/\bw\/o\b/g, 'without ');
		text = text.replace(/\betc\./g, 'etcetera');
		text = text.replace(/\be\.g\./g, 'for example');
		text = text.replace(/\bi\.e\./g, 'that is');
		
		// Ensure the response isn't too long for voice
		const maxLength = 300;
		if (text.length > maxLength) {
			// Try to cut at a sentence boundary
			const sentences = text.split(/[.!?]+/);
			let result = '';
			for (const sentence of sentences) {
				if ((result + sentence).length > maxLength) break;
				result += sentence + '. ';
			}
			text = result.trim();
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