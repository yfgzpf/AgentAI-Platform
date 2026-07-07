// Test Agnes TTS API
const apiKey = 'sk-2kZib5wx9y61ySNMgXuYE960jvOvxrW26XZj2X0YTBVKLomG';

async function testAgnesTTS() {
  console.log('Testing Agnes TTS API...\n');

  // Test 1: Check /v1/models
  console.log('=== Test 1: /v1/models ===');
  try {
    const resp = await fetch('https://apihub.agnes-ai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await resp.json();
    console.log('✅ /v1/models works');
    console.log('Models:', data.data?.map((m) => m.id).join(', '));
  } catch (err) {
    console.log('❌ /v1/models failed:', err.message);
  }

  // Test 2: Check if TTS endpoint exists
  console.log('\n=== Test 2: /v1/tts (POST) ===');
  try {
    const resp = await fetch('https://apihub.agnes-ai.com/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: '你好世界',
        voice: 'zh-CN-XiaoxiaoNeural'
      })
    });
    
    if (resp.ok) {
      const contentType = resp.headers.get('Content-Type');
      console.log('✅ /v1/tts works');
      console.log('Content-Type:', contentType);
      
      if (contentType?.includes('audio')) {
        console.log('✅ Returns audio data');
      } else {
        const data = await resp.json();
        console.log('Response:', JSON.stringify(data, null, 2));
      }
    } else {
      const text = await resp.text();
      console.log('❌ /v1/tts HTTP', resp.status);
      console.log('Error:', text.slice(0, 200));
    }
  } catch (err) {
    console.log('❌ /v1/tts failed:', err.message);
  }

  // Test 3: Check Azure TTS compatible endpoint
  console.log('\n=== Test 3: Azure TTS compatible endpoint ===');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
    <voice name="zh-CN-XiaoxiaoNeural">
      <prosody rate="0%">你好世界</prosody>
    </voice>
  </speak>`;
  
  try {
    const resp = await fetch('https://apihub.agnes-ai.com/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm'
      },
      body: ssml
    });
    
    if (resp.ok) {
      const contentType = resp.headers.get('Content-Type');
      console.log('✅ SSML endpoint works');
      console.log('Content-Type:', contentType);
    } else {
      const text = await resp.text();
      console.log('❌ SSML endpoint HTTP', resp.status);
      console.log('Error:', text.slice(0, 200));
    }
  } catch (err) {
    console.log('❌ SSML endpoint failed:', err.message);
  }

  console.log('\n=== Test Complete ===');
}

testAgnesTTS();
