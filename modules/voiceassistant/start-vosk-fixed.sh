#!/bin/bash

echo "🚀 Starting Vosk Speech Recognition Service..."

# Navigate to the voice assistant directory (updated path)
cd ~/Documents/Projects/MagicMirrorAI/modules/voiceassistant

# Check if virtual environment exists
if [ ! -d "vosk-env" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv vosk-env
    
    echo "📥 Installing packages..."
    source vosk-env/bin/activate
    pip install vosk numpy pyaudio
else
    echo "✅ Virtual environment found"
    source vosk-env/bin/activate
fi

# Check if model exists
if [ ! -d "models/vosk-model-en-us" ]; then
    echo "⬇️ Downloading Vosk model..."
    mkdir -p models
    cd models
    wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
    unzip vosk-model-small-en-us-0.15.zip
    mv vosk-model-small-en-us-0.15 vosk-model-en-us
    rm vosk-model-small-en-us-0.15.zip
    cd ..
    echo "✅ Model downloaded to: $(pwd)/models/vosk-model-en-us"
fi

echo "🎙️ Starting Vosk service..."
echo "📍 Current directory: $(pwd)"
echo "🐍 Python path: $(which python)"

# Test Vosk import first
python -c "import vosk; print('✅ Vosk import successful')" || {
    echo "❌ Failed to import Vosk"
    exit 1
}

# Start the service
python vosk-service.py 