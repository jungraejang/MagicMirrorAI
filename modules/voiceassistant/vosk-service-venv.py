#!/home/pi/vosk-env/bin/python3
"""
Vosk Speech Recognition Service for MagicMirror (Virtual Environment Version)
Provides HTTP API for speech recognition using Vosk
"""

import json
import vosk
import pyaudio
import wave
import tempfile
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time

class VoskService:
    def __init__(self, model_path="models/vosk-model-en-us", sample_rate=16000):
        print("🚀 Initializing Vosk service...")
        
        # Set log level to reduce Vosk output
        vosk.SetLogLevel(-1)
        
        self.model_path = model_path
        self.sample_rate = sample_rate
        self.model = None
        self.recognizer = None
        self.is_recording = False
        
        # Initialize model
        self.load_model()
        
    def load_model(self):
        try:
            print(f"📦 Loading Vosk model from: {self.model_path}")
            if not os.path.exists(self.model_path):
                raise FileNotFoundError(f"Model not found: {self.model_path}")
                
            self.model = vosk.Model(self.model_path)
            self.recognizer = vosk.KaldiRecognizer(self.model, self.sample_rate)
            print("✅ Vosk model loaded successfully")
            
        except Exception as e:
            print(f"❌ Failed to load Vosk model: {e}")
            raise
    
    def transcribe_audio_file(self, audio_file_path):
        """Transcribe audio from WAV file"""
        try:
            wf = wave.open(audio_file_path, 'rb')
            
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != self.sample_rate:
                print(f"❌ Audio file must be WAV format mono PCM {self.sample_rate}Hz")
                return None
            
            # Reset recognizer
            rec = vosk.KaldiRecognizer(self.model, self.sample_rate)
            
            # Process audio
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                rec.AcceptWaveform(data)
            
            # Get final result
            result = json.loads(rec.FinalResult())
            text = result.get('text', '').strip()
            
            wf.close()
            return text
            
        except Exception as e:
            print(f"❌ Error transcribing audio: {e}")
            return None

class VoskHTTPHandler(BaseHTTPRequestHandler):
    def __init__(self, vosk_service, *args, **kwargs):
        self.vosk_service = vosk_service
        super().__init__(*args, **kwargs)
    
    def do_POST(self):
        if self.path == '/transcribe':
            try:
                # Get content length
                content_length = int(self.headers['Content-Length'])
                
                # Read audio data
                audio_data = self.rfile.read(content_length)
                
                # Save to temporary WAV file
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                    tmp_file.write(audio_data)
                    tmp_file.flush()
                    
                    # Transcribe
                    text = self.vosk_service.transcribe_audio_file(tmp_file.name)
                    
                    # Clean up
                    os.unlink(tmp_file.name)
                
                # Send response
                if text:
                    response = {'success': True, 'text': text}
                    print(f"🗣️ Transcribed: '{text}'")
                else:
                    response = {'success': False, 'error': 'No speech detected'}
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                
            except Exception as e:
                print(f"❌ Error processing request: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                error_response = {'success': False, 'error': str(e)}
                self.wfile.write(json.dumps(error_response).encode())
        
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_GET(self):
        if self.path == '/status':
            response = {
                'status': 'running',
                'model_loaded': self.vosk_service.model is not None,
                'sample_rate': self.vosk_service.sample_rate
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

def main():
    print("🎙️ MagicMirror Vosk Speech Recognition Service (Virtual Env)")
    print("=" * 60)
    
    # Initialize Vosk service
    try:
        vosk_service = VoskService()
    except Exception as e:
        print(f"❌ Failed to initialize Vosk service: {e}")
        return
    
    # Create HTTP server
    def handler(*args, **kwargs):
        VoskHTTPHandler(vosk_service, *args, **kwargs)
    
    port = 5000
    server = HTTPServer(('0.0.0.0', port), handler)
    
    print(f"🌐 Vosk service running on http://0.0.0.0:{port}")
    print("📡 Available endpoints:")
    print("  POST /transcribe - Transcribe uploaded WAV file")
    print("  GET  /status     - Service status")
    print("")
    print("🎯 Ready for speech recognition requests!")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down Vosk service...")
        server.shutdown()

if __name__ == "__main__":
    main() 