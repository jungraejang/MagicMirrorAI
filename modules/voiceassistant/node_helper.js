const NodeHelper = require("node_helper");
const axios = require("axios");
const Log = require("logger");
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

module.exports = NodeHelper.create({
	
	start() {
		console.log(`🚀 [${this.name}] Node helper started - STARTUP CONFIRMED`);
		this.config = {};
		this.conversationHistory = [];
	},

	socketNotificationReceived(notification, payload) {
		console.log(`📨 [${this.name}] Received notification: ${notification}`);
		
		switch (notification) {
			case "CONFIG":
				this.config = payload;
				console.log(`⚙️ [${this.name}] Config received:`, this.config);
				
				// Test Vosk service connectivity
				this.testVoskConnection();
				break;
				
			case "PROCESS_SPEECH":
				this.processLLMRequest(payload.userInput, payload.conversation);
				break;

			case "VOSK_TRANSCRIBE":
				this.transcribeWithVosk(payload.audioData, payload.isCommand, payload.originalFormat, payload.needsConversion);
				break;
				
			case "VOSK_WAKE_WORD":
				console.log(`🎯 [${this.name}] Wake word detection request received`);
				this.transcribeForWakeWord(payload.audioData);
				break;
		}
	},

	async transcribeWithVosk(audioData, isCommand = false, originalFormat = 'wav', needsConversion = false) {
		try {
			const logPrefix = isCommand ? "Command" : "Wake word";
			console.log(`🎙️ [${this.name}] Processing ${logPrefix.toLowerCase()} audio (${originalFormat} format, needsConversion: ${needsConversion})...`);
			
			let processedAudioData = audioData;
			
			// Handle server-side conversion if needed
			if (needsConversion && originalFormat !== 'wav') {
				console.log(`🔄 [${this.name}] Attempting server-side conversion from ${originalFormat} to WAV...`);
				try {
					processedAudioData = await this.convertAudioToWav(audioData, originalFormat);
					console.log(`✅ [${this.name}] Server-side conversion successful`);
				} catch (conversionError) {
					console.error(`❌ [${this.name}] Server-side conversion failed:`, conversionError.message);
					this.sendSocketNotification("VOSK_TRANSCRIPTION", {
						success: false,
						error: `Audio conversion failed: ${conversionError.message}`
					});
					return;
				}
			}
			
			const voskUrl = "http://localhost:5000/transcribe";
			
			const response = await axios.post(voskUrl, processedAudioData, {
				headers: {
					'Content-Type': 'audio/wav',
				},
				timeout: isCommand ? 15000 : 10000
			});

			if (response.data.success) {
				const transcript = response.data.text.trim();
				console.log(`🗣️ [${this.name}] ${logPrefix} transcribed: "${transcript}"`);
				
				if (transcript || !isCommand) {
					// For wake word detection, empty transcript is normal (silence)
					// For commands, we expect some text
					this.sendSocketNotification("VOSK_TRANSCRIPTION", {
						success: true,
						transcript: transcript
					});
				} else {
					console.log(`⚠️ [${this.name}] Empty ${logPrefix.toLowerCase()} transcription`);
					this.sendSocketNotification("VOSK_TRANSCRIPTION", {
						success: false,
						error: "No speech detected in command"
					});
				}
			} else {
				console.error(`❌ [${this.name}] ${logPrefix} transcription failed:`, response.data.error);
				this.sendSocketNotification("VOSK_TRANSCRIPTION", {
					success: false,
					error: response.data.error
				});
			}

		} catch (error) {
			const logPrefix = isCommand ? "Command" : "Wake word";
			console.error(`❌ [${this.name}] ${logPrefix} transcription error:`, error.message);
			
			// Provide more specific error messages for command transcription
			let errorMessage = `Vosk service error: ${error.message}`;
			if (isCommand) {
				if (error.code === 'ECONNREFUSED') {
					errorMessage = "Cannot connect to Vosk service - is it running?";
				} else if (error.code === 'ETIMEDOUT') {
					errorMessage = "Vosk service timeout - audio may be too long or corrupted";
				}
			}
			
			this.sendSocketNotification("VOSK_TRANSCRIPTION", {
				success: false,
				error: errorMessage
			});
		}
	},

	async convertAudioToWav(audioData, originalFormat) {
		// Create temporary files
		const tempDir = os.tmpdir();
		const inputFile = path.join(tempDir, `vosk_input_${Date.now()}.${this.getFileExtension(originalFormat)}`);
		const outputFile = path.join(tempDir, `vosk_output_${Date.now()}.wav`);
		
		try {
			// Write input audio data to temporary file
			await fs.writeFile(inputFile, Buffer.from(audioData));
			console.log(`📄 [${this.name}] Wrote ${originalFormat} file: ${inputFile} (${audioData.byteLength} bytes)`);
			
			// Check if ffmpeg is available
			try {
				await this.runCommand('ffmpeg', ['-version']);
				console.log(`✅ [${this.name}] ffmpeg is available`);
			} catch (error) {
				console.error(`❌ [${this.name}] ffmpeg not found:`, error.message);
				throw new Error('ffmpeg is required for audio conversion but not installed. Please run: sudo apt install -y ffmpeg');
			}
			
			// Use ffmpeg to convert to WAV
			const ffmpegArgs = [
				'-i', inputFile,
				'-acodec', 'pcm_s16le',
				'-ar', '16000',
				'-ac', '1',
				'-y',  // Overwrite output file
				outputFile
			];
			
			console.log(`🔄 [${this.name}] Running ffmpeg conversion: ffmpeg ${ffmpegArgs.join(' ')}`);
			const ffmpegOutput = await this.runCommand('ffmpeg', ffmpegArgs);
			console.log(`📋 [${this.name}] ffmpeg output:`, ffmpegOutput);
			
			// Check if output file was created
			try {
				const stats = await fs.stat(outputFile);
				console.log(`📊 [${this.name}] Output file size: ${stats.size} bytes`);
			} catch (error) {
				throw new Error(`ffmpeg conversion failed - output file not created: ${error.message}`);
			}
			
			// Read converted WAV file
			const wavData = await fs.readFile(outputFile);
			console.log(`✅ [${this.name}] Conversion complete, WAV size: ${wavData.length} bytes`);
			
			// Clean up temporary files
			await fs.unlink(inputFile).catch(err => console.warn(`⚠️ [${this.name}] Could not remove input file:`, err.message));
			await fs.unlink(outputFile).catch(err => console.warn(`⚠️ [${this.name}] Could not remove output file:`, err.message));
			
			return wavData;
			
		} catch (error) {
			console.error(`❌ [${this.name}] Audio conversion failed:`, error.message);
			// Clean up temporary files on error
			await fs.unlink(inputFile).catch(() => {});
			await fs.unlink(outputFile).catch(() => {});
			throw error;
		}
	},

	runCommand(command, args, timeout = 30000) {
		return new Promise((resolve, reject) => {
			console.log(`🔧 [${this.name}] Running: ${command} ${args.join(' ')}`);
			
			const process = spawn(command, args);
			let stdout = '';
			let stderr = '';
			
			// Set timeout
			const timer = setTimeout(() => {
				process.kill('SIGTERM');
				reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
			}, timeout);
			
			process.stdout.on('data', (data) => {
				stdout += data.toString();
			});
			
			process.stderr.on('data', (data) => {
				stderr += data.toString();
			});
			
			process.on('close', (code) => {
				clearTimeout(timer);
				console.log(`📋 [${this.name}] Command finished with code ${code}`);
				if (stderr) console.log(`📋 [${this.name}] stderr:`, stderr);
				
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`${command} failed with code ${code}. stderr: ${stderr}`));
				}
			});
			
			process.on('error', (error) => {
				clearTimeout(timer);
				console.error(`❌ [${this.name}] Process error:`, error.message);
				reject(new Error(`Failed to run ${command}: ${error.message}`));
			});
		});
	},

	getFileExtension(mimeType) {
		const mimeToExt = {
			'audio/webm': 'webm',
			'audio/ogg': 'ogg',
			'audio/mp4': 'm4a',
			'audio/mpeg': 'mp3',
			'audio/wav': 'wav'
		};
		
		// Handle codec specifications
		const baseMimeType = mimeType.split(';')[0];
		return mimeToExt[baseMimeType] || 'audio';
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
	},

	async testVoskConnection() {
		try {
			console.log(`🔍 [${this.name}] Testing Vosk service connection...`);
			
			const voskUrl = "http://localhost:5000/transcribe";
			
			// Send a simple test request with empty data
			const response = await axios.post(voskUrl, Buffer.alloc(0), {
				headers: {
					'Content-Type': 'audio/wav',
				},
				timeout: 3000
			});

			console.log(`✅ [${this.name}] Vosk service is running and accessible`);
			console.log(`📊 [${this.name}] Vosk test response:`, response.data);

		} catch (error) {
			console.error(`❌ [${this.name}] Vosk service connection failed:`, error.message);
			console.error(`💡 [${this.name}] Make sure Vosk service is running: python3 modules/voiceassistant/vosk-service.py`);
		}
	},

	async transcribeForWakeWord(audioData) {
		try {
			console.log(`🎯 [${this.name}] Processing audio for wake word detection...`);
			
			const voskUrl = "http://localhost:5000/transcribe";
			
			const response = await axios.post(voskUrl, audioData, {
				headers: {
					'Content-Type': 'audio/wav',
				},
				timeout: 5000  // Shorter timeout for wake word detection
			});

			if (response.data.success) {
				const transcript = response.data.text.trim();
				
				// Handle silence as normal - don't log it as noise
				if (transcript) {
					console.log(`🗣️ [${this.name}] Wake word audio transcribed: "${transcript}"`);
				}
				
				this.sendSocketNotification("VOSK_WAKE_WORD", {
					success: true,
					transcript: transcript // Can be empty for silence
				});
			} else {
				// "No speech detected" is normal during continuous monitoring
				if (response.data.error === "No speech detected") {
					// Send success with empty transcript for silence
					this.sendSocketNotification("VOSK_WAKE_WORD", {
						success: true,
						transcript: ""
					});
				} else {
					// Only log actual errors
					console.error(`❌ [${this.name}] Vosk wake word error:`, response.data.error);
					this.sendSocketNotification("VOSK_WAKE_WORD", {
						success: false,
						error: response.data.error
					});
				}
			}

		} catch (error) {
			// Only log connection errors, not speech detection issues
			console.error(`❌ [${this.name}] Vosk service connection error:`, error.message);
			this.sendSocketNotification("VOSK_WAKE_WORD", {
				success: false,
				error: `Vosk service error: ${error.message}`
			});
		}
	}
}); 