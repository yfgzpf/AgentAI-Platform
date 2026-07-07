/**
 * Edge TTS Service - 使用 edge-tts Python 库
 * 免费、无需 API Key、支持多音色
 */
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const EDGE_TTS_VOICES = [
  // 中文
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-YunjianNeural', name: '云健', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-XiaochenNeural', name: '晓辰', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaohanNeural', name: '晓涵', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaomengNeural', name: '晓梦', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaomoNeural', name: '晓墨', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoqiuNeural', name: '晓秋', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoruiNeural', name: '晓睿', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoshuangNeural', name: '晓双', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoyanNeural', name: '晓颜', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoyouNeural', name: '晓悠', gender: 'female', locale: 'zh-CN' },
  { id: 'zh-CN-YunfengNeural', name: '云枫', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-YunhaoNeural', name: '云皓', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-YunyeNeural', name: '云野', gender: 'male', locale: 'zh-CN' },
  { id: 'zh-CN-YunzeNeural', name: '云泽', gender: 'male', locale: 'zh-CN' },
  // 粤语
  { id: 'zh-HK-HiuMaanNeural', name: '晓曼(粤语)', gender: 'female', locale: 'zh-HK' },
  { id: 'zh-HK-WanLungNeural', name: '云龙(粤语)', gender: 'male', locale: 'zh-HK' },
  // 台湾
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻(台湾)', gender: 'female', locale: 'zh-TW' },
  { id: 'zh-TW-YunJheNeural', name: '云哲(台湾)', gender: 'male', locale: 'zh-TW' },
  // 英文
  { id: 'en-US-AriaNeural', name: 'Aria', gender: 'female', locale: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy', gender: 'male', locale: 'en-US' },
  { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'female', locale: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'female', locale: 'en-GB' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'male', locale: 'en-GB' },
  // 日文
  { id: 'ja-JP-NanamiNeural', name: 'Nanami', gender: 'female', locale: 'ja-JP' },
  { id: 'ja-JP-KeitaNeural', name: 'Keita', gender: 'male', locale: 'ja-JP' },
  // 韩文
  { id: 'ko-KR-SunHiNeural', name: 'SunHi', gender: 'female', locale: 'ko-KR' },
  { id: 'ko-KR-InJoonNeural', name: 'InJoon', gender: 'male', locale: 'ko-KR' },
];

export function getEdgeTtsVoices() {
  return EDGE_TTS_VOICES;
}

export async function synthesizeWithEdgeTTS(
  text: string,
  voice: string = 'zh-CN-XiaoxiaoNeural',
  rate: string = '+0%'
): Promise<Buffer> {
  const tmpDir = tmpdir();
  const inputFile = join(tmpDir, `edge-tts-input-${Date.now()}.txt`);
  const outputFile = join(tmpDir, `edge-tts-output-${Date.now()}.mp3`);

  try {
    // 写入文本到临时文件
    writeFileSync(inputFile, text, 'utf-8');

    // 调用 edge-tts
    await new Promise<void>((resolve, reject) => {
      const python = process.platform === 'win32' ? 'python' : 'python3';
      const args = [
        '-m', 'edge_tts',
        '--voice', voice,
        '--rate', rate,
        '-f', inputFile,
        '--write-media', outputFile,
      ];

      console.log(`[edge-tts] Running: ${python} ${args.join(' ')}`);

      const proc = spawn(python, args, {
        timeout: 60000,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`edge-tts exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn edge-tts: ${err.message}`));
      });
    });

    // 读取生成的音频
    if (!existsSync(outputFile)) {
      throw new Error('edge-tts did not generate output file');
    }

    const audioBuffer = readFileSync(outputFile);
    return audioBuffer;

  } finally {
    // 清理临时文件
    try {
      if (existsSync(inputFile)) unlinkSync(inputFile);
      if (existsSync(outputFile)) unlinkSync(outputFile);
    } catch {}
  }
}

export async function checkEdgeTtsAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(python, ['-m', 'edge_tts', '--help'], { timeout: 5000 });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}
