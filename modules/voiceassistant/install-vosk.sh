#!/bin/bash

echo "🚀 Installing Vosk for MagicMirror Voice Assistant..."

# Update package list
echo "📦 Updating package list..."
sudo apt update

# Install required system packages
echo "🔧 Installing system dependencies..."
sudo apt install -y python3-pip python3-pyaudio portaudio19-dev wget unzip

# Install Python dependencies
echo "📦 Installing Python packages..."
pip3 install vosk numpy

# Create models directory
echo "📁 Creating models directory..."
mkdir -p ~/MagicMirror/modules/voiceassistant/models

# Download lightweight English model (around 40MB)
echo "⬇️ Downloading Vosk English model..."
cd ~/MagicMirror/modules/voiceassistant/models
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
mv vosk-model-small-en-us-0.15 vosk-model-en-us
rm vosk-model-small-en-us-0.15.zip

echo "✅ Vosk installation complete!"
echo "📍 Model location: ~/MagicMirror/modules/voiceassistant/models/vosk-model-en-us"

# Test Vosk installation
echo "🧪 Testing Vosk installation..."
cd ~/MagicMirror/modules/voiceassistant/models
python3 -c "
import vosk
import json
print('✅ Vosk imported successfully')
model = vosk.Model('vosk-model-en-us')
print('✅ Model loaded successfully')
print('🎉 Vosk is ready to use!')
"

echo ""
echo "🎯 Next steps:"
echo "1. Copy the vosk-service.py file to your Pi"
echo "2. Update your MagicMirror voiceassistant module"
echo "3. Start the Vosk service: python3 vosk-service.py" 