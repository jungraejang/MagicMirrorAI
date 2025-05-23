#!/usr/bin/env python3
"""
Vosk Speech Recognition Service for MagicMirror
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
            print(f"🔍 Transcribing audio file: {audio_file_path}")
            print(f"📊 File size: {os.path.getsize(audio_file_path)} bytes")
            
            wf = wave.open(audio_file_path, 'rb')
            
            # Check audio format
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            frame_rate = wf.getframerate()
            frames = wf.getnframes()
            
            print(f"🎵 Audio format: {channels} channels, {sample_width} bytes/sample, {frame_rate} Hz, {frames} frames")
            
            if channels != 1 or sample_width != 2 or frame_rate != self.sample_rate:
                print(f"❌ Audio file must be WAV format mono PCM {self.sample_rate}Hz")
                print(f"   Got: {channels} channels, {sample_width} bytes/sample, {frame_rate} Hz")
                wf.close()
                return None
            
            # Reset recognizer
            rec = vosk.KaldiRecognizer(self.model, self.sample_rate)
            
            # Process audio and analyze levels
            frames_processed = 0
            max_amplitude = 0
            total_energy = 0
            
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                
                frames_processed += len(data) // 2  # 2 bytes per sample
                
                # Analyze audio levels
                import struct
                samples = struct.unpack(f'<{len(data)//2}h', data)
                chunk_max = max(abs(s) for s in samples) if samples else 0
                chunk_energy = sum(s*s for s in samples) / len(samples) if samples else 0
                
                max_amplitude = max(max_amplitude, chunk_max)
                total_energy += chunk_energy
                
                rec.AcceptWaveform(data)
            
            avg_energy = total_energy / (frames_processed // 4000) if frames_processed > 0 else 0
            
            print(f"📊 Processed {frames_processed} audio frames")
            print(f"🔊 Audio levels - Max amplitude: {max_amplitude}/32767 ({max_amplitude/32767*100:.1f}%)")
            print(f"🔊 Average energy: {avg_energy:.0f}")
            
            # Determine if audio has meaningful signal
            if max_amplitude < 100:
                print("⚠️ Audio signal very weak - microphone might be muted or too far")
            elif max_amplitude < 1000:
                print("⚠️ Audio signal weak - try speaking louder or closer to microphone")
            else:
                print("✅ Audio signal strength looks good")
            
            # Get final result
            result = json.loads(rec.FinalResult())
            text = result.get('text', '').strip()
            
            print(f"🎯 Vosk result: {result}")
            print(f"📝 Extracted text: '{text}'")
            
            wf.close()
            return text
            
        except Exception as e:
            print(f"❌ Error transcribing audio: {e}")
            print(f"❌ Exception type: {type(e).__name__}")
            import traceback
            print(f"❌ Traceback: {traceback.format_exc()}")
            return None
    
    def record_and_transcribe(self, duration=5):
        """Record audio from microphone and transcribe"""
        try:
            print(f"🎤 Recording for {duration} seconds...")
            
            # Audio settings
            chunk = 1024
            format = pyaudio.paInt16
            channels = 1
            rate = self.sample_rate
            
            # Initialize PyAudio
            p = pyaudio.PyAudio()
            
            # Open stream
            stream = p.open(format=format,
                           channels=channels,
                           rate=rate,
                           input=True,
                           frames_per_buffer=chunk)
            
            frames = []
            
            # Record
            for i in range(0, int(rate / chunk * duration)):
                data = stream.read(chunk)
                frames.append(data)
            
            print("🔇 Recording finished")
            
            # Stop and close stream
            stream.stop_stream()
            stream.close()
            p.terminate()
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                wf = wave.open(tmp_file.name, 'wb')
                wf.setnchannels(channels)
                wf.setsampwidth(p.get_sample_size(format))
                wf.setframerate(rate)
                wf.writeframes(b''.join(frames))
                wf.close()
                
                # Transcribe
                text = self.transcribe_audio_file(tmp_file.name)
                
                # Clean up
                os.unlink(tmp_file.name)
                
                return text
                
        except Exception as e:
            print(f"❌ Error recording audio: {e}")
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
        
        elif self.path == '/record':
            try:
                # Record and transcribe
                text = self.vosk_service.record_and_transcribe(duration=5)
                
                if text:
                    response = {'success': True, 'text': text}
                    print(f"🗣️ Recorded and transcribed: '{text}'")
                else:
                    response = {'success': False, 'error': 'No speech detected'}
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                
            except Exception as e:
                print(f"❌ Error recording: {e}")
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
    print("🎙️ MagicMirror Vosk Speech Recognition Service")
    print("=" * 50)
    
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
    print("  POST /record     - Record 5 seconds and transcribe")
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