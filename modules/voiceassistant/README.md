# Voice Assistant Module for MagicMirror²

A voice-controlled assistant module that integrates with your local LLM running on Raspberry Pi 4.

## Features

- 🎤 **Wake Word Detection**: Say "Hello Mirror" to activate
- 🧠 **Local LLM Integration**: Uses your LLM at `http://127.0.0.1:1234`
- 🗣️ **Text-to-Speech**: Speaks responses back to you
- 💬 **Conversation History**: Maintains context across exchanges
- 🎨 **Visual Feedback**: Shows listening/processing/responding states
- 🔧 **Configurable**: Customizable wake words, prompts, and behavior

## Prerequisites

1. **Raspberry Pi 4** with microphone and speakers
2. **Local LLM** running on your desktop at `http://192.168.0.109:1234/v1/chat/completions`
3. **Browser with Speech Recognition support** (Chrome/Chromium recommended)
4. **Microphone permissions** enabled for the browser
5. **Network connectivity** between Raspberry Pi and desktop

## Installation

1. Navigate to your MagicMirror modules directory:

```bash
cd ~/MagicMirror/modules
```

2. The module files should already be in `modules/voiceassistant/`

3. Add the module to your `config/config.js`:

```javascript
{
    module: "voiceassistant",
    position: "top_right", // or any position you prefer
    config: {
        wakeWord: "hello mirror",
        language: "en-US",
        enableDisplay: true,
        speechSynthesis: true,
        llmEndpoint: "http://192.168.0.109:1234/v1/chat/completions",
        systemPrompt: "You are a helpful voice assistant for a smart mirror. Keep responses concise and conversational.",
        debugMode: false
    }
}
```

## Configuration Options

| Option                   | Type    | Default                                           | Description                      |
| ------------------------ | ------- | ------------------------------------------------- | -------------------------------- |
| `wakeWord`               | String  | `"hello mirror"`                                  | Phrase to activate the assistant |
| `language`               | String  | `"en-US"`                                         | Language for speech recognition  |
| `enableDisplay`          | Boolean | `true`                                            | Show visual interface            |
| `displayTimeout`         | Number  | `10000`                                           | Hide display after ms            |
| `speechSynthesis`        | Boolean | `true`                                            | Enable text-to-speech            |
| `llmEndpoint`            | String  | `"http://192.168.0.109:1234/v1/chat/completions"` | Your LLM API endpoint            |
| `maxConversationHistory` | Number  | `5`                                               | Number of exchanges to remember  |
| `systemPrompt`           | String  |                                                   | Instructions for the LLM         |
| `debugMode`              | Boolean | `false`                                           | Enable debug logging             |

## Setup Your Local LLM

Make sure your LLM server is running on your desktop and accessible at `http://192.168.0.109:1234`. The module expects an OpenAI-compatible API with `/v1/chat/completions` endpoint.

**Important Network Setup:**

- Your desktop IP: `192.168.0.109`
- Your Raspberry Pi should be on the same network: `192.168.0.x`
- Make sure your desktop's firewall allows connections on port 1234

Popular LLM options:

- **LM Studio**
- **Ollama** with OpenAI compatibility
- **Text Generation WebUI** with OpenAI extension
- **llama.cpp** with server mode

## Usage

1. **Activation**: Say "Hello Mirror" (or your configured wake word)
2. **Speak**: The microphone icon will turn blue and pulse - speak your question
3. **Wait**: The assistant will process your request (orange spinning brain icon)
4. **Listen**: The response will be spoken aloud and displayed (green message icon)

## Troubleshooting

### Speech Recognition Not Working

- Ensure you're using Chrome/Chromium browser
- Check microphone permissions in browser settings
- Try refreshing the page and allowing microphone access

### Wake Word Not Detected

- Speak clearly and at normal volume
- Try saying the wake word multiple times
- Enable `debugMode: true` to see what's being heard

### LLM Connection Issues

- Verify your LLM is running on your desktop at `http://192.168.0.109:1234`
- Check the endpoint URL in configuration
- Ensure both devices are on the same network (192.168.0.x)
- Test the endpoint manually with curl from the Raspberry Pi:

```bash
curl -X POST http://192.168.0.109:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"hello"}],"max_tokens":10}'
```

### Audio Output Issues

- Check system volume and speaker connections
- Verify browser can access speakers
- Try toggling `speechSynthesis: false` to disable voice output

## Module Positions

The module can be placed in any MagicMirror region:

- `top_bar`, `top_left`, `top_center`, `top_right`
- `upper_third`, `middle_center`, `lower_third`
- `bottom_left`, `bottom_center`, `bottom_right`, `bottom_bar`
- `fullscreen_above`, `fullscreen_below`

## API Integration

The module can be controlled by other modules using notifications:

```javascript
// Wake up the assistant
this.sendNotification("VOICE_ASSISTANT_WAKE");

// Put assistant to sleep
this.sendNotification("VOICE_ASSISTANT_SLEEP");
```

## Privacy Notes

- All speech processing happens locally
- No data is sent to external services
- Your conversation history is kept only in memory
- LLM communication stays within your local network

## License

MIT License - Feel free to modify and distribute!
