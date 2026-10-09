/**
 * 视频模型分发 + 尾帧提取 + 提示词润色 回归测试
 * ========================================================================
 * 覆盖用户实机反馈的三个问题:
 *   V1「状态选择的是 2.5 Flash 模型，但生成区显示的是智谱模型，导致生成失败」
 *   V2「续集生成失败, 请手动截图视频最后一帧上传」
 *   V3「提示词润色会重复多的重述」
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const rd = (rel: string) => readFileSync(nodePath.join(ROOT, rel), 'utf-8');

const videoSrc = rd('packages/agentai-gateway/src/routes/video.ts');
const ffmpegSrc = rd('packages/agentai-gateway/src/ffmpeg.ts');
const videoGenSrc = rd('packages/agentai-gui/src/components/VideoGen.tsx');
const chatSrc = rd('packages/agentai-gateway/src/routes/chat.ts');

/**
 * 去注释 —— 只留可执行代码
 *
 * 不做这一步，测试会匹配到注释里"旧实现长什么样"的说明文字，产生假红。
 * 假红比没有测试更糟：它会让人以为修复没生效，从而把正确的修复改回去。
 */
function codeOnly(src: string): string {
  const NL = String.fromCharCode(10);
  return src
    .split(NL)
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join(NL);
}

const videoCode = codeOnly(videoSrc);
const NL = String.fromCharCode(10);

// ════════════════════════════════════════════════════════════════════════
// V1 模型分发
// ════════════════════════════════════════════════════════════════════════

describe('V1 视频模型严格按 reqModel 分发', () => {
  it('★ 不再有「只看 key 存在就返回」的引擎 1', () => {
    // 旧: if (AGNES_VIDEO_API_KEY) return submitAgnesVideo25(...)  —— 忽略 reqModel
    const legacy = /if\s*\(\s*agnesVideoKey\s*\)\s*\{[^}]*submitAgnesVideo25/;
    expect(
      videoCode,
      '「配置了 AGNES_VIDEO_API_KEY 就无条件用它」会让用户选的模型被静默替换',
    ).not.toMatch(legacy);
  });

  it('四个模型各有独立的 reqModel 判断', () => {
    expect(videoCode).toMatch(/requested\s*===\s*'agnes-video-2\.5'/);
    expect(videoCode).toMatch(/requested\s*===\s*'agnes'/);
    expect(videoCode).toMatch(/requested\s*===\s*'cogvideo'/);
    expect(videoCode).toMatch(/requested\.startsWith\('seedance'\)/);
  });

  it('每个分支缺 key 都返回明确错误（含 requiredEnv），不静默换引擎', () => {
    const keyChecks = (videoCode.match(/requiredEnv:/g) || []).length;
    expect(keyChecks, '四个模型都应有 requiredEnv 提示').toBeGreaterThanOrEqual(4);
  });

  it('错误信息里包含用户选的模型名（便于自查）', () => {
    expect(videoCode).toMatch(/所选模型/);
  });

  it('未知模型返回 400 而不是随便挑一个引擎', () => {
    expect(videoCode).toMatch(/未知的视频模型/);
  });

  it('★ 轮询侧：cogvideox-flash 不会被误判成 Agnes Flash', () => {
    // 旧: provider.includes('flash') → 智谱的 'cogvideox-flash' 也命中 → 查错后端
    //
    // 现在仍有一处 `!provider.includes('flash')`，但它被
    // `startsWith('agnes-video-2.5')` 前置约束了（正式版要排除 flash 名），
    // 智谱的 cogvideox-flash 根本进不来。
    // 关键断言：不存在「裸的 includes('flash') 作为唯一条件」。
    const bareFlashCheck = /if\s*\(\s*provider\.includes\('flash'\)\s*\)/;
    expect(
      videoCode,
      "存在裸的 provider.includes('flash') 判定 —— 智谱任务会被送到 Agnes 查询接口",
    ).not.toMatch(bareFlashCheck);
    // Agnes Flash 分支必须显式排除 cogvideo
    expect(videoCode).toMatch(/!provider\.startsWith\('cogvideo'\)/);
  });

  it('轮询侧对 cogvideo 走独立分支', () => {
    expect(videoCode).toMatch(/provider\.startsWith\('cogvideo'\)/);
  });

  it('★ 旧引擎链已删除，cogvideo 提交 URL 只出现一次', () => {
    const occurrences = (videoCode.match(/open\.bigmodel\.cn\/api\/paas\/v4\/videos/g) || []).length;
    expect(occurrences, 'cogvideo 提交 URL 应只出现在 submitCogVideo 里一处').toBe(1);
  });

  it('submitCogVideo 支持 end_frame（续集首尾帧）', () => {
    expect(videoCode).toMatch(/async function submitCogVideo\([^)]*endFrame\?/);
    expect(videoCode).toMatch(/body\.end_image_url = endFrame/);
  });

  it('submitSeedance / submitCogVideo 已抽成独立函数', () => {
    expect(videoCode).toMatch(/async function submitCogVideo/);
    expect(videoCode).toMatch(/async function submitSeedance/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// V2 尾帧提取 / ffmpeg
// ════════════════════════════════════════════════════════════════════════

describe('V2 尾帧提取不再笼统报错', () => {
  it('★ video.ts 里不再有 execSync（命令注入面 + 阻塞事件循环）', () => {
    expect(videoCode, 'execSync 拼 ffmpeg 命令是命令注入面').not.toMatch(/execSync/);
  });

  it('全部改用 runFfmpeg 参数数组（≥6 处）', () => {
    const calls = (videoCode.match(/runFfmpeg\(\[/g) || []).length;
    // extract-tail 2 + extract-frames 2 + next-episode 2
    expect(calls).toBeGreaterThanOrEqual(6);
  });

  it('★ 不再有「请确保 ffmpeg 已安装」这种无用提示', () => {
    expect(videoCode).not.toContain('请确保 ffmpeg 已安装');
  });

  it('改用 explainFfmpegError 给出可执行原因（≥4 处）', () => {
    const uses = (videoCode.match(/explainFfmpegError\(/g) || []).length;
    expect(uses, '所有 ffmpeg 失败点都要翻译成可操作提示').toBeGreaterThanOrEqual(4);
  });

  it('ffmpeg.ts 提供探测 + 提示 + 封装', () => {
    expect(ffmpegSrc).toMatch(/export function hasFfmpeg/);
    expect(ffmpegSrc).toMatch(/export function runFfmpeg/);
    expect(ffmpegSrc).toMatch(/export function explainFfmpegError/);
  });

  it('ffmpeg 缺失提示含安装方法与降级方案', () => {
    expect(ffmpegSrc).toMatch(/winget install/);
    expect(ffmpegSrc).toMatch(/上传尾帧/);
    expect(ffmpegSrc).toMatch(/ffmpeg -version/);
  });

  it('ffmpeg 调用走 execFile 不经 shell', () => {
    expect(ffmpegSrc).toMatch(/execFile\(/);
  });

  it('hasFfmpeg 带缓存 + 兜底扫描常见安装路径', () => {
    expect(ffmpegSrc).toMatch(/let cached/);
    expect(ffmpegSrc).toMatch(/ProgramFiles/);
    expect(ffmpegSrc).toMatch(/homebrew/);
  });

  it('★ 前端把后端原因透出，不再只说「请手动截图」', () => {
    expect(videoGenSrc).toMatch(/尾帧提取失败\$\{reason/);
    expect(videoGenSrc).toMatch(/续集生成失败：\$\{reason\}/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// V3 提示词润色不重复
// ════════════════════════════════════════════════════════════════════════

describe('V3 提示词润色不再层层叠加', () => {
  it('后端指令显式禁止复述原文', () => {
    expect(chatSrc).toMatch(/不要复述用户原文/);
    expect(chatSrc).toMatch(/也不复述原文/);
  });

  it('★ 前端有幂等保护：输出只是回显原文时不替换', () => {
    expect(videoGenSrc).toMatch(/merelyEchoes/);
    expect(videoGenSrc).toMatch(/避免重复叠加润色/);
  });

  it('本地降级增强是幂等的（重复点不会无限追加）', () => {
    expect(videoGenSrc).toMatch(/smooth natural motion\[/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// V4 前后端模型值一致
// ════════════════════════════════════════════════════════════════════════

describe('V4 前后端模型值一致', () => {
  it('前端 MODELS 的 value 与后端 requested 判断对得上', () => {
    for (const m of ['agnes-video-2.5', 'agnes', 'cogvideo', 'seedance-2.5']) {
      expect(videoGenSrc, `前端缺模型 ${m}`).toContain("value: '" + m + "'");
    }
  });

  it('后端错误信息列出的可用模型与前端一致', () => {
    expect(videoCode).toMatch(/agnes-video-2\.5 \/ agnes \/ cogvideo \/ seedance-2\.5/);
  });

  it('★ 前端提交时确实带上 model（否则后端无法按模型分发）', () => {
    expect(videoGenSrc).toMatch(/videoTaskManager\.submitTask\(\{[\s\S]{0,400}?model,/);
  });
});

void NL;