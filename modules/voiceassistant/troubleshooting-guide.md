# Voice Assistant Troubleshooting Guide

## When "Nothing Happens" - Step by Step Debug

### Step 1: Check Module Loading

1. **Verify module is in config.js**:

```javascript
// In your config/config.js, make sure you have:
{
    module: "voiceassistant",
    position: "top_right", // or any valid position
    config: {
        llmEndpoint: "http://10.5.0.2:1234/v1/chat/completions",
        debugMode: true // IMPORTANT: Enable this for troubleshooting
    }
}
```

2. **Check browser console**:
   - Open browser developer tools (F12)
   - Go to Console tab
   - Look for any red error messages
   - Look for "Starting module: voiceassistant" message

### Step 2: Enable Debug Mode

Update your config to enable debug mode:

```javascript
{
    module: "voiceassistant",
    position: "top_right",
    config: {
        llmEndpoint: "http://10.5.0.2:1234/v1/chat/completions",
        debugMode: true,           // Enable debug logging
        enableDisplay: true,       // Make sure UI is visible
        wakeWord: "hello mirror"
    }
}
```

Restart MagicMirror and check the console for debug messages.

### Step 3: Check Browser Compatibility

**Required Browser**: Chrome or Chromium (Firefox and Safari have limited speech recognition support)

```bash
# On Raspberry Pi, install Chromium if not already installed
sudo apt update
sudo apt install chromium-browser

# Start MagicMirror with Chromium
DISPLAY=:0 chromium-browser --start-fullscreen --kiosk --incognito --noerrdialogs --disable-translate --no-first-run --fast --fast-start --disable-infobars --disable-features=TranslateUI --disk-cache-dir=/dev/null --overscroll-history-navigation=0 --disable-pinch --autoplay-policy=no-user-gesture-required http://localhost:8080
```

### Step 4: Test Microphone Permissions

1. **Check if microphone is working**:

```bash
# Test microphone hardware
arecord -l  # List audio devices
arecord -d 5 test.wav  # Record 5 seconds of audio
aplay test.wav  # Play it back
```

2. **Browser microphone permissions**:
   - When you first load MagicMirror, browser should ask for microphone permission
   - Click "Allow" when prompted
   - If no prompt appears, check browser settings manually

### Step 5: Visual Debug - Check UI

The voice assistant should show a visual indicator. Look for:

- **Gray microphone with slash**: Waiting for wake word
- **Blue pulsing microphone**: Listening
- **Orange spinning brain**: Processing
- **Green message icon**: Responding

If you don't see ANY of these, the module isn't loading properly.

### Step 6: Test Speech Recognition Manually

Add this test to your browser console:

```javascript
// Test speech recognition in browser console
if ("webkitSpeechRecognition" in window) {
  console.log("Speech recognition supported");
  var recognition = new webkitSpeechRecognition();
  recognition.onresult = function (event) {
    console.log("Heard:", event.results[0][0].transcript);
  };
  recognition.start();
  console.log("Say something now...");
} else {
  console.log("Speech recognition NOT supported");
}
```

### Step 7: Test Network Connectivity

From your Raspberry Pi, test the LLM connection:

```bash
# Test basic connectivity
ping -c 3 10.5.0.2

# Test LLM endpoint
curl -v http://10.5.0.2:1234/v1/models

# Test actual chat completion
curl -X POST http://10.5.0.2:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'
```

### Step 8: Check MagicMirror Logs

```bash
# If using PM2
pm2 logs MagicMirror

# If running manually
# Check the terminal where you started MagicMirror
```

## Common Issues and Solutions

### Issue: "Speech recognition not supported"

**Solution**: Use Chrome/Chromium browser, not Firefox or Safari

### Issue: No microphone permissions

**Solutions**:

- Restart browser and allow permissions
- Check system audio settings
- Try: `sudo usermod -a -G audio pi`

### Issue: Module not visible

**Solutions**:

- Check config.js syntax (missing commas, brackets)
- Verify module position is valid
- Set `enableDisplay: true`

### Issue: Wake word not detected

**Solutions**:

- Speak clearly and at normal volume
- Try different wake words: "hello mirror", "hey mirror"
- Check debug console for what's being heard

### Issue: LLM connection fails

**Solutions**:

- Verify LLM server is running on desktop
- Check desktop firewall (Windows Defender, antivirus)
- Ensure LLM listens on `0.0.0.0:1234`, not `127.0.0.1:1234`

## Debug Command Sequence

Run these commands in order:

```bash
# 1. Test hardware
arecord -l
aplay /usr/share/sounds/alsa/Front_Left.wav

# 2. Test network
ping 10.5.0.2
curl -I http://10.5.0.2:1234

# 3. Test LLM
curl -X POST http://10.5.0.2:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"test"}],"max_tokens":5}'

# 4. Check MagicMirror process
ps aux | grep -i magic
pm2 status

# 5. Restart MagicMirror
pm2 restart MagicMirror
```

## Expected Debug Output

When working correctly, you should see:

```
Starting module: voiceassistant
Voice Assistant configured with LLM endpoint: http://10.5.0.2:1234/v1/chat/completions
Wake word detection heard: "hello mirror hi"
Wake word detected!
Speech recognized: "hi"
Processing user speech: "hi"
```

## Quick Test Configuration

Try this minimal config first:

```javascript
{
    module: "voiceassistant",
    position: "middle_center",
    config: {
        llmEndpoint: "http://10.5.0.2:1234/v1/chat/completions",
        debugMode: true,
        enableDisplay: true,
        wakeWord: "hello mirror",
        speechSynthesis: false  // Disable TTS for initial testing
    }
}
```
