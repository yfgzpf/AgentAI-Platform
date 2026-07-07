// Test Edge TTS
const testText = '你好，这是微软 Edge TTS 测试';
const voiceName = 'zh-CN-XiaoxiaoNeural';

const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voiceName}">
    <prosody rate="0%">${testText}</prosody>
  </voice>
</speak>`;

async function testEdgeTTS() {
  console.log('Testing Edge TTS...\n');
  
  try {
    const resp = await fetch('https://chinaeast2.tts.speech.microsoft.com/cognitiveservices/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
        'User-Agent': 'AgentAI',
        'Ocp-Apim-Subscription-Key': '', // Edge TTS 不需要 key
      },
      body: ssml,
    });
    
    console.log('Status:', resp.status);
    console.log('Content-Type:', resp.headers.get('Content-Type'));
    
    if (resp.ok) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      console.log('✅ Edge TTS works!');
      console.log('Audio size:', buffer.length, 'bytes');
      
      // Save to file
      const fs = require('fs');
      fs.writeFileSync('test-edge-tts.wav', buffer);
      console.log('Saved to test-edge-tts.wav');
    } else {
      const text = await resp.text();
      console.log('❌ Edge TTS failed:', text.slice(0, 200));
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
  }
}

testEdgeTTS();
