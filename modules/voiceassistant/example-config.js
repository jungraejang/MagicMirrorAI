// Example configuration for MagicMirror config/config.js
// Add this module configuration to your modules array

const voiceAssistantConfig = {
	module: "voiceassistant",
	position: "top_right", // Choose your preferred position
	config: {
		// Wake word to activate the assistant
		wakeWord: "hello mirror",
		
		// Language for speech recognition
		language: "en-US",
		
		// Visual interface settings
		enableDisplay: true,
		displayTimeout: 10000, // Hide display after 10 seconds
		
		// Audio settings
		speechSynthesis: true, // Enable text-to-speech responses
		
		// LLM API configuration
		llmEndpoint: "http://192.168.0.109:1234/v1/chat/completions",
		
		// Conversation settings
		maxConversationHistory: 5, // Remember last 5 exchanges
		
		// System prompt for the LLM
		systemPrompt: "You are a helpful voice assistant for a smart mirror. Keep responses concise and conversational. You can help with questions about time, weather, news, general knowledge, and simple tasks. Always be friendly and helpful.",
		
		// Debug mode (set to true for troubleshooting)
		debugMode: false
	}
};

/* 
Alternative configurations for different use cases:

// Minimal voice assistant (no visual display)
const minimalConfig = {
	module: "voiceassistant",
	position: "top_right",
	config: {
		enableDisplay: false,
		wakeWord: "hey mirror",
		systemPrompt: "You are a minimal voice assistant. Give very brief responses."
	}
};

// Voice assistant with custom wake word and specialized role
const advancedConfig = {
	module: "voiceassistant", 
	position: "middle_center",
	config: {
		wakeWord: "computer",
		language: "en-US",
		systemPrompt: "You are FRIDAY, an advanced AI assistant integrated into a smart mirror. You have access to real-time information and can help with scheduling, reminders, smart home control, and general assistance. Be professional but personable.",
		maxConversationHistory: 10,
		displayTimeout: 15000
	}
};

// Debug mode configuration for troubleshooting
const debugConfig = {
	module: "voiceassistant",
	position: "bottom_center", 
	config: {
		debugMode: true,
		wakeWord: "test mirror",
		speechSynthesis: false, // Disable TTS for testing
		systemPrompt: "You are in debug mode. Respond with very short answers for testing.",
		displayTimeout: 5000
	}
};
*/

// Export for use in other files
if (typeof module !== "undefined") {
	module.exports = voiceAssistantConfig;
} 