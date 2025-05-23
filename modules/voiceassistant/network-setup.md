# Network Setup Guide for Voice Assistant

## Your Network Configuration

- **Desktop IP**: `10.5.0.2` (where LLM is running)
- **Network**: `192.168.0.x/24`
- **LLM Endpoint**: `http://10.5.0.2:1234/v1/chat/completions`

## Prerequisites

1. **LLM Server**: Running on your desktop (10.5.0.2) on port 1234
2. **Raspberry Pi**: Connected to the same network (should get 192.168.0.x IP)
3. **Firewall**: Desktop firewall should allow connections on port 1234

## Setup Steps

### 1. Check Network Connectivity

From your Raspberry Pi, test if you can reach your desktop:

```bash
# Test basic connectivity
ping 10.5.0.2

# Test LLM port specifically
curl -I http://10.5.0.2:1234
```

### 2. Configure Desktop Firewall

**Windows:**

```powershell
# Allow inbound connections on port 1234
netsh advfirewall firewall add rule name="LLM Server" dir=in action=allow protocol=TCP localport=1234
```

**Linux/macOS:**

```bash
# For UFW (Ubuntu)
sudo ufw allow 1234

# For iptables
sudo iptables -A INPUT -p tcp --dport 1234 -j ACCEPT
```

### 3. Test LLM Endpoint

From Raspberry Pi, test the LLM endpoint:

```bash
curl -X POST http://10.5.0.2:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'
```

Expected response should be JSON with a `choices` array.

### 4. LLM Server Configuration

Make sure your LLM server is configured to:

- Listen on `0.0.0.0:1234` (not just 127.0.0.1)
- Accept connections from your network
- Provide OpenAI-compatible API at `/v1/chat/completions`

**Common LLM Server Start Commands:**

```bash
# LM Studio: Usually configured in GUI to allow network access

# Ollama with OpenAI compatibility
ollama serve --host 0.0.0.0:1234

# llama.cpp server
./server -m model.gguf --host 0.0.0.0 --port 1234

# Text Generation WebUI
python server.py --listen-host 0.0.0.0 --listen-port 1234 --extensions openai
```

### 5. Voice Assistant Configuration

Your MagicMirror config should include:

```javascript
{
    module: "voiceassistant",
    position: "top_right",
    config: {
        llmEndpoint: "http://10.5.0.2:1234/v1/chat/completions",
        debugMode: true // Enable for initial testing
    }
}
```

## Troubleshooting

### Connection Refused

- Check if LLM server is running: `netstat -an | grep 1234`
- Verify firewall settings
- Try accessing from desktop first: `curl http://localhost:1234/v1/models`

### DNS Issues

- Use IP address instead of hostname
- Check if both devices are on same subnet

### Permission Errors

- Ensure LLM server has network permissions
- Check if antivirus is blocking connections

### Test Checklist

✅ Desktop LLM server running on port 1234  
✅ Raspberry Pi can ping desktop (10.5.0.2)  
✅ Firewall allows port 1234  
✅ LLM responds to curl test  
✅ MagicMirror config updated with correct IP  
✅ Browser microphone permissions granted

## Network Diagram

```
Desktop (10.5.0.2)          Raspberry Pi (192.168.0.x)
┌─────────────────────┐         ┌──────────────────────┐
│                     │         │                      │
│  LLM Server         │◄────────┤  MagicMirror²        │
│  Port 1234          │  HTTP   │  Voice Assistant     │
│                     │         │                      │
└─────────────────────┘         └──────────────────────┘
         │                                   │
         └───────────────┬───────────────────┘
                         │
                 Router (192.168.0.1)
```
