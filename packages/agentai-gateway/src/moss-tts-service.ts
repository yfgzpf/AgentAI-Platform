/**
 * MOSS-TTS-Service — MOSS-TTS-Nano Python sidecar 进程管理器
 *
 * 路径策略:
 *   - MOSS_TTS_SKILLS_DIR 环境变量 → 自定义 skills 目录
 *   - MOSS_TTS_HF_CACHE    环境变量 → 自定义模型缓存目录
 *   - 桌面端打包: 模型缓存放在资源目录, 开箱即用
 *   - 开发模式:  自动 fallback 到项目相对路径
 * 模型下载:
 *   - 首次使用自动从 HF 镜像下载 (hf-mirror.com)
 *   - 下载进度通过 getModelStatus() 查询
 *   - 下载过程在 start() 之前异步完成
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { request as httpRequest, type RequestOptions } from 'http';
import { existsSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MOSS_PORT = 18083;
const MOSS_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL_MS = 5000;
const MAX_STARTUP_WAIT_MS = 300_000; // 5 分钟 (含首次下载)

// HF 模型 ID
const HF_TTS_MODEL = 'OpenMOSS-Team/MOSS-TTS-Nano';
const HF_AUDIO_TOKENIZER = 'OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano';

/** 技能目录/可执行文件路径 */
function getMossExePath(): string {
  // 桌面端打包: resources/moss-tts-server/moss-tts-server.exe
  const bundleExe = resolve(process.cwd(), 'resources', 'moss-tts-server', 'moss-tts-server.exe');
  if (existsSync(bundleExe)) return bundleExe;
  // 桌面端备选: _resources (Tauri 2.0 解压目录)
  const bundleExe2 = resolve(process.cwd(), '_resources', 'moss-tts-server', 'moss-tts-server.exe');
  if (existsSync(bundleExe2)) return bundleExe2;
  // 开发模式: 从多种路径查找 app.py
  const candidates = [
    resolve(process.cwd(), 'packages', 'agentai-skills', 'moss-tts-nano', 'app.py'),
    resolve(process.cwd(), '..', 'agentai-skills', 'moss-tts-nano', 'app.py'),
    resolve(__dirname, '..', '..', '..', 'packages', 'agentai-skills', 'moss-tts-nano', 'app.py'),
    resolve(__dirname, '..', '..', 'agentai-skills', 'moss-tts-nano', 'app.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return 'python';
  }
  return '';
}

/** HF 模型缓存目录 */
function getHfCacheDir(): string {
  const envDir = process.env.MOSS_TTS_HF_CACHE;
  if (envDir) return resolve(envDir);
  // 桌面端打包: resources/huggingface
  const bundleCache = resolve(process.cwd(), 'resources', 'huggingface');
  if (existsSync(bundleCache)) return bundleCache;
  const bundleCache2 = resolve(process.cwd(), '_resources', 'huggingface');
  if (existsSync(bundleCache2)) return bundleCache2;
  // 开发模式: 使用短路径避免 Windows 260 字符限制
  const homedir = process.env.USERPROFILE || process.env.HOME || 'C:\\';
  return resolve(homedir, '.hf_cache');
}

export type DownloadPhase = 'idle' | 'checking' | 'downloading' | 'complete' | 'error';

export interface ModelDownloadStatus {
  phase: DownloadPhase;
  progress: number;       // 0-100
  message: string;
  ttsModelExists: boolean;
  audioTokenizerExists: boolean;
  error?: string;
}

export interface TtsSynthesisOptions {
  text: string;
  demoId?: string;
  promptAudioPath?: string;
  maxNewFrames?: number;
  voiceCloneMaxTextTokens?: number;
}

export interface TtsSynthesisResult {
  audioBase64: string;
  sampleRate: number;
  runStatus: string;
  promptAudioPath: string;
  normalizedText: string;
  textChunks: string[];
}

export type ServiceStatus = 'downloading' | 'starting' | 'ready' | 'failed' | 'stopped';

export class MossTtsService extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ServiceStatus = 'stopped';
  private statusMessage = '未启动';
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private _mossDevDir: string = '';

  private get mossDevDir(): string {
    if (this._mossDevDir) return this._mossDevDir;
    const candidates = [
      resolve(process.cwd(), 'packages', 'agentai-skills', 'moss-tts-nano'),
      resolve(process.cwd(), '..', 'agentai-skills', 'moss-tts-nano'),
      resolve(__dirname, '..', '..', '..', 'packages', 'agentai-skills', 'moss-tts-nano'),
      resolve(__dirname, '..', '..', 'agentai-skills', 'moss-tts-nano'),
    ];
    for (const d of candidates) {
      if (existsSync(resolve(d, 'app.py'))) {
        this._mossDevDir = d;
        return d;
      }
    }
    return '';
  }

  // 下载状态
  private _downloadStatus: ModelDownloadStatus = {
    phase: 'idle',
    progress: 0,
    message: '等待检查模型...',
    ttsModelExists: false,
    audioTokenizerExists: false,
  };

  get currentStatus(): ServiceStatus { return this.status; }
  get currentStatusMessage(): string { return this.statusMessage; }
  get isReady(): boolean { return this.status === 'ready'; }

  get downloadStatus(): ModelDownloadStatus { return this._downloadStatus; }

  /** 检查模型是否已下载 */
  checkModelsExist(): { ttsModelExists: boolean; audioTokenizerExists: boolean } {
    const hfCacheHub = resolve(getHfCacheDir(), 'hub');
    const result = { ttsModelExists: false, audioTokenizerExists: false };

    // 检查 HF hub 缓存: models--OpenMOSS-Team--MOSS-TTS-Nano 目录下有 snapshots
    if (existsSync(hfCacheHub)) {
      try {
        const ttsDir = resolve(hfCacheHub, 'models--OpenMOSS-Team--MOSS-TTS-Nano', 'snapshots');
        if (existsSync(ttsDir) && readdirSync(ttsDir).length > 0) {
          // 检查是否有 pytorch_model.bin
          for (const snap of readdirSync(ttsDir)) {
            if (existsSync(resolve(ttsDir, snap, 'pytorch_model.bin'))) {
              result.ttsModelExists = true;
              break;
            }
          }
        }
        const audioDir = resolve(hfCacheHub, 'models--OpenMOSS-Team--MOSS-Audio-Tokenizer-Nano', 'snapshots');
        if (existsSync(audioDir) && readdirSync(audioDir).length > 0) {
          result.audioTokenizerExists = true;
        }
      } catch { /* 忽略检查错误 */ }
    }
    return result;
  }

  /** 下载模型（首次使用自动调用） */
  async ensureModels(): Promise<void> {
    const exist = this.checkModelsExist();
    if (exist.ttsModelExists && exist.audioTokenizerExists) {
      this._downloadStatus = {
        phase: 'complete',
        progress: 100,
        message: '模型已就绪',
        ttsModelExists: true,
        audioTokenizerExists: true,
      };
      return;
    }

    this.status = 'downloading';
    this._downloadStatus = {
      phase: 'downloading',
      progress: 0,
      message: '首次使用，正在下载 TTS 模型 (~2GB)...',
      ttsModelExists: exist.ttsModelExists,
      audioTokenizerExists: exist.audioTokenizerExists,
    };
    this.emit('download-status', this._downloadStatus);

    try {
      const hfCacheDir = getHfCacheDir();
      const hfHubDir = resolve(hfCacheDir, 'hub');
      mkdirSync(hfHubDir, { recursive: true });

      // 用 Python huggingface_hub 下载，可获取进度
      // 先写一个临时的下载脚本
      const scriptPath = resolve(hfCacheDir, '_download_models.py');
      const script = `
import sys, os, json
os.environ['HF_HOME'] = ${JSON.stringify(hfCacheDir)}
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'

from huggingface_hub import snapshot_download

models = [
    ('${HF_TTS_MODEL}', ${exist.ttsModelExists ? 'False' : 'True'}),
    ('${HF_AUDIO_TOKENIZER}', ${exist.audioTokenizerExists ? 'False' : 'True'}),
]

total = sum(1 for _, needed in models if needed)
done = 0

for model_id, needed in models:
    if not needed:
        continue
    print(f'DL:0:{done/total*100:.0f}|Downloading {model_id}...')
    sys.stdout.flush()
    
    # snapshot_download with progress
    def progress_callback(current, total_size, status):
        pct = min(100, int(current / max(total_size, 1) * 100))
        overall = (done + pct / 100) / total * 100
        print(f'DL:{pct}:{overall:.0f}|{model_id}: {current//1024**2}MB/{total_size//1024**2}MB')
        sys.stdout.flush()
    
    snapshot_download(
        model_id,
        cache_dir=${JSON.stringify(hfHubDir)},
        endpoint='https://hf-mirror.com',
        ignore_patterns=['*.h5', '*.ot', '*.msgpack'],
    )
    done += 1
    print(f'DL:100:{done/total*100:.0f}|{model_id} done')
    sys.stdout.flush()

print('DL:DONE|All models downloaded')
sys.stdout.flush()
`;
      writeFileSync(scriptPath, script, 'utf-8');

      const python = this._findPython();
      await new Promise<void>((resolve_, reject) => {
        const proc = spawn(python, [scriptPath], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            HF_HOME: hfCacheDir,
            HF_ENDPOINT: 'https://hf-mirror.com',
            HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          },
        });

        proc.stdout?.on('data', (data: Buffer) => {
          const lines = data.toString().trim().split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            console.log(`[moss-tts:dl] ${trimmed}`);

            // 解析进度: DL:{subPct}:{overallPct}|{message}
            const m = trimmed.match(/^DL:(\d+|DONE):(\d*)([^|]*)\|(.+)$/);
            if (m) {
              const phase = m[1];
              const pct = parseInt(m[2] || '0', 10);
              const msg = m[4];
              if (phase === 'DONE') {
                this._downloadStatus = {
                  phase: 'complete',
                  progress: 100,
                  message: '模型下载完成',
                  ttsModelExists: true,
                  audioTokenizerExists: true,
                };
              } else {
                const pctVal = isNaN(pct) ? 0 : pct;
                this._downloadStatus = {
                  phase: 'downloading',
                  progress: pctVal,
                  message: msg || '下载中...',
                  ttsModelExists: exist.ttsModelExists,
                  audioTokenizerExists: exist.audioTokenizerExists,
                };
              }
              this.emit('download-status', this._downloadStatus);
            }
          }
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line) console.log(`[moss-tts:dl:err] ${line}`);
        });

        proc.on('close', (code) => {
          try { existsSync(scriptPath) && unlinkSync(scriptPath); } catch { /* ignore */ }
          if (code === 0) {
            resolve_();
          } else {
            this._downloadStatus = {
              phase: 'error',
              progress: 0,
              message: '模型下载失败',
              ttsModelExists: false,
              audioTokenizerExists: false,
              error: `下载进程退出 code=${code}`,
            };
            this.emit('download-status', this._downloadStatus);
            reject(new Error(`模型下载失败 (code=${code})`));
          }
        });

        proc.on('error', (err) => {
          try { existsSync(scriptPath) && unlinkSync(scriptPath); } catch { /* ignore */ }
          this._downloadStatus = {
            phase: 'error',
            progress: 0,
            message: `下载出错: ${err.message}`,
            ttsModelExists: false,
            audioTokenizerExists: false,
            error: err.message,
          };
          this.emit('download-status', this._downloadStatus);
          reject(err);
        });
      });
    } catch (err: any) {
      this._downloadStatus = {
        phase: 'error',
        progress: 0,
        message: `下载失败: ${err.message}`,
        ttsModelExists: false,
        audioTokenizerExists: false,
        error: err.message,
      };
      this.emit('download-status', this._downloadStatus);
      console.warn(`[moss-tts] ${this._downloadStatus.message}`);
    }
  }

  /** 启动 MOSS-TTS Python sidecar（非阻塞） */
  async start(): Promise<void> {
    if (this.process) {
      console.warn('[moss-tts] 服务已在运行中');
      return;
    }

    // 1) 检查模型，不存在则尝试下载（失败不阻塞，降级到浏览器 TTS）
    const exist = this.checkModelsExist();
    if (!exist.ttsModelExists || !exist.audioTokenizerExists) {
      console.log('[moss-tts] 模型未就绪，尝试自动下载...');
      try {
        await this.ensureModels();
      } catch (err: any) {
        console.warn(`[moss-tts] 模型下载失败: ${err.message}，将使用浏览器 TTS 备用`);
        this._downloadStatus = {
          phase: 'error',
          progress: 0,
          message: `下载失败: ${err.message}，已降级到浏览器 TTS`,
          ttsModelExists: false,
          audioTokenizerExists: false,
          error: err.message,
        };
        this.emit('download-status', this._downloadStatus);
        this.status = 'failed';
        this.statusMessage = '模型下载失败，使用浏览器 TTS 备用';
        return;
      }
    }

    // 二次检查：下载后模型仍不存在则退出
    const postDl = this.checkModelsExist();
    if (!postDl.ttsModelExists || !postDl.audioTokenizerExists) {
      console.warn('[moss-tts] 模型仍不可用，使用浏览器 TTS 备用');
      this.status = 'failed';
      this.statusMessage = '模型不可用，使用浏览器 TTS 备用';
      return;
    }

    this.status = 'starting';
    this.statusMessage = '正在启动 MOSS-TTS-Nano...';

    try {
      const exePath = getMossExePath();
      const hfCacheDir = getHfCacheDir();

      if (!exePath) {
        throw new Error('MOSS-TTS 可执行文件未找到 (resources 或 packages/agentai-skills/moss-tts-nano)');
      }

      let command: string;
      let args: string[];
      let cwd: string;

      if (exePath === 'python') {
        // 开发模式: python app.py
        const devDir = this.mossDevDir;
        if (!devDir) throw new Error('找不到 moss-tts-nano 目录');
        command = this._findPython();
        args = ['app.py'];
        cwd = devDir;
        console.log(`[moss-tts] 开发模式: ${command} app.py (cwd=${devDir})`);
      } else {
        // 桌面端: moss-tts-server.exe
        command = exePath;
        args = [];
        cwd = resolve(exePath, '..');
        console.log(`[moss-tts] 桌面端模式: ${command}`);
      }

      console.log(`[moss-tts] HF 缓存: ${hfCacheDir}`);
      console.log(`[moss-tts] 模型就绪: ${existsSync(resolve(hfCacheDir, 'hub'))}`);

      this.process = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          HF_HOME: hfCacheDir,
          HF_ENDPOINT: 'https://hf-mirror.com',
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        },
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log(`[moss-tts:out] ${line}`);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        if (line) console.log(`[moss-tts:err] ${line}`);
      });

      this.process.on('error', (err: Error) => {
        console.error(`[moss-tts] 进程错误: ${err.message}`);
        this.status = 'failed';
        this.statusMessage = `进程错误: ${err.message}`;
      });

      this.process.on('exit', (code, signal) => {
        console.warn(`[moss-tts] 进程退出 code=${code} signal=${signal}`);
        this.process = null;
        if (this.status !== 'stopped') {
          this.status = 'failed';
          this.statusMessage = `进程意外退出 (code=${code})`;
        }
      });

      await this._waitForReady();
    } catch (err: any) {
      this.status = 'failed';
      this.statusMessage = `启动失败: ${err.message}`;
      console.error(`[moss-tts] ${this.statusMessage}`);
    }
  }

  /** 文字转语音 — 调用 Python sidecar HTTP API */
  async synthesize(opts: TtsSynthesisOptions): Promise<TtsSynthesisResult> {
    if (this.status !== 'ready') {
      throw new Error(`TTS 服务未就绪 (${this.statusMessage})`);
    }

    const encoder = new TextEncoder();
    const boundary = `----MOSS${Date.now().toString(36)}`;
    const encodeField = (name: string, value: string): Uint8Array => {
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      return encoder.encode(header);
    };

    const parts: Uint8Array[] = [];
    parts.push(encodeField('text', opts.text));
    parts.push(encodeField('demo_id', opts.demoId || ''));
    parts.push(encodeField('max_new_frames', String(opts.maxNewFrames || 375)));
    parts.push(encodeField('voice_clone_max_text_tokens', String(opts.voiceCloneMaxTextTokens || 75)));
    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = Buffer.concat(parts.map(p => Buffer.from(p)));

    const response = await this._httpRequest('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(totalLength),
      },
    }, body);

    if (response.statusCode !== 200) {
      throw new Error(`TTS 服务返回 ${response.statusCode}: ${response.body.slice(0, 300)}`);
    }

    const data = JSON.parse(response.body);
    if (data.error) {
      throw new Error(`TTS 服务错误: ${data.error}`);
    }

    return {
      audioBase64: data.audio_base64 || '',
      sampleRate: data.sample_rate || 48000,
      runStatus: data.run_status || '',
      promptAudioPath: data.prompt_audio_path || '',
      normalizedText: data.normalized_text || '',
      textChunks: data.text_chunks || [],
    };
  }

  /** 获取可用音色列表 — 始终返回（含内置音色预设） */
  async getVoices(): Promise<Array<{ id: string; name: string; gender: string }>> {
    // 内置音色预设
    const builtIn: Array<{ id: string; name: string; gender: string }> = [
      { id: 'Junhao', name: 'Junhao (男声A)', gender: 'male' },
      { id: 'Zhiming', name: 'Zhiming (男声B)', gender: 'male' },
      { id: 'Weiguo', name: 'Weiguo (男声C)', gender: 'male' },
      { id: 'Xiaoyu', name: 'Xiaoyu (女声A)', gender: 'female' },
      { id: 'Yuewen', name: 'Yuewen (女声B)', gender: 'female' },
      { id: 'Lingyu', name: 'Lingyu (女声C)', gender: 'female' },
      { id: 'Trump', name: 'Trump (英文)', gender: 'male' },
      { id: 'Ava', name: 'Ava (英文)', gender: 'female' },
      { id: 'Bella', name: 'Bella (英文)', gender: 'female' },
      { id: 'Adam', name: 'Adam (英文)', gender: 'male' },
      { id: 'Nathan', name: 'Nathan (英文)', gender: 'male' },
      { id: 'Sakura', name: 'Sakura (日文)', gender: 'female' },
      { id: 'Yui', name: 'Yui (日文)', gender: 'female' },
      { id: 'Aoi', name: 'Aoi (日文)', gender: 'female' },
    ];

    // 如果服务运行中，尝试从 demo entries 获取更多音色
    if (this.status === 'ready') {
      try {
        const response = await this._httpRequest('/api/demo-entries', { method: 'GET' });
        if (response.statusCode === 200) {
          const data = JSON.parse(response.body);
          const entries = data.demo_entries || [];
          const demoVoices = entries.map((e: any, i: number) => ({
            id: e.demo_id || `demo-${i}`,
            name: (e.name || `Demo ${i}`) + ' (音色克隆)',
            gender: 'neutral' as const,
          }));
          return [...builtIn, ...demoVoices];
        }
      } catch { /* 忽略 */ }
    }

    return builtIn;
  }

  /** 停止 Python 进程 */
  stop(): void {
    this.status = 'stopped';
    this.statusMessage = '已停止';
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.process) {
      console.log('[moss-tts] 停止服务...');
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) {
          try { this.process.kill('SIGKILL'); } catch { /* 已退出 */ }
        }
      }, 3000);
      this.process = null;
    }
  }

  /* ---- 私有方法 ---- */

  private _findPython(): string {
    const candidates = ['python3', 'python'];
    for (const cmd of candidates) {
      try {
        const result = execSync(`${cmd} --version`, { stdio: 'pipe' });
        if (result) return cmd;
      } catch { /* 尝试下一个 */ }
    }
    return 'python';
  }

  private async _waitForReady(): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_STARTUP_WAIT_MS) {
      await this._sleep(2000);
      try {
        const response = await this._httpRequest('/health', { method: 'GET' });
        if (response.statusCode === 200) {
          this.status = 'ready';
          this.statusMessage = `就绪 (${MOSS_HOST}:${MOSS_PORT})`;
          console.log(`[moss-tts] ✅ 服务就绪 (耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
          return;
        }
      } catch {
        this.statusMessage = `等待启动中... (${Math.round((Date.now() - startTime) / 1000)}s)`;
      }
    }
    throw new Error(`启动超时 (${MAX_STARTUP_WAIT_MS / 1000}s)`);
  }

  private _httpRequest(path: string, opts: Partial<RequestOptions>, body?: string | Uint8Array): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve_, reject) => {
      const req = httpRequest({
        hostname: MOSS_HOST,
        port: MOSS_PORT,
        path,
        method: opts.method || 'GET',
        headers: opts.headers,
        timeout: 60_000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve_({
            statusCode: res.statusCode || 500,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      if (body) req.write(body);
      req.end();
    });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

/** 全局单例 */
export const mossTtsService = new MossTtsService();
