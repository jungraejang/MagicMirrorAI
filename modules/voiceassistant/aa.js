// Test microphone permissions first
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✅ Microphone access granted:', stream.getAudioTracks());
    stream.getTracks().forEach(track => track.stop());
    
    // Now test speech recognition
    testSpeechRecognition();
  })
  .catch(err => {
    console.error('❌ Microphone access denied:', err);
  });

function testSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  
  recognition.onstart = () => console.log('🎤 Recognition started');
  recognition.onerror = (e) => console.error('❌ Recognition error:', e);
  recognition.onresult = (e) => console.log('🗣️ Heard:', e.results[0][0].transcript);
  
  try {
    recognition.start();
    console.log('✅ Starting speech recognition test...');
  } catch (error) {
    console.error('❌ Failed to start:', error);
  }
}