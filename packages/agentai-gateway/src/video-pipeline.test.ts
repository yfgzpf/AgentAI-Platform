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
const storyboardSrc = rd('packages/agentai-gui/src/components/StoryboardPanel.tsx');
const taskManagerSrc = rd('packages/agentai-gui/src/services/videoTaskManager.ts');
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
    // 2026-10-20: seedance 从 startsWith('seedance') 改为 normalizeSeedanceModel 归一
    // (旧门槛只认官方 id, 前端实际传的 factory-seedance-* / doubao-seedance-* 全掉 400)
    expect(videoCode).toMatch(/normalizeSeedanceModel\(requested\)/);
  });

  it('★ seedance 三种前缀形态都能进分发 (2026-10-20 P0 回归)', () => {
    // 用户实锤: 生视频选工厂 seed 模型报"未知的视频模型" —— 前端下拉传的是
    // modelStore 工厂条目 id (factory-seedance-2.5), 旧门槛 startsWith('seedance') 不匹配。
    // normalizeSeedanceModel 必须把三种形态统一归一成 doubao-seedance-<variant>。
    expect(videoCode).toMatch(/export function normalizeSeedanceModel/);
    expect(videoCode).toMatch(/SEEDANCE_VARIANTS/);
    // 归一正则同时吃 factory- / doubao- / 裸 seedance- 前缀
    expect(videoCode).toMatch(/\(\?:factory-\)\?\(\?:doubao-\)\?seedance-/);
  });

  it('★ 未知 seedance 变体不被误放行 (白名单外仍走 400)', () => {
    // seedance-3 / seedance-9-pro 这类不存在: normalizeSeedanceModel 返回 null,
    // 不能因为"前缀像 seedance"就放行到上游收 model_not_found。
    expect(videoCode).toMatch(/includes\(variant\)\) return null/);
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

  it('★ engines 目录 name 与 modelStore 工厂视频 id 一致 (灰显逻辑的对齐契约)', () => {
    // 2026-10-20 实锤: 批次9.1 把 engines name 写成 doubao-seedance-*, 而前端
    // engineStatus[m.value] 的 m.value = modelStore 条目 id (factory-seedance-*) →
    // 查询键永远 undefined → 工厂条目永不禁用 (没配 FACTORY_VIDEO_KEY 也能选)。
    // 这条契约锁死"两处命名必须同一套", 谁再单改一头谁红。
    const modelStoreSrc = rd('packages/agentai-gui/src/store/modelStore.ts');
    const factoryVideoIds = [...codeOnly(modelStoreSrc).matchAll(/\{ id: '(factory-seedance-[^']+)'/g)].map((m) => m[1]!);
    const engineNames = [...videoCode.matchAll(/\{ name: '(factory-seedance-[^']+)'/g)].map((m) => m[1]!);
    expect(factoryVideoIds.length, 'modelStore 应有 4 个工厂视频条目').toBe(4);
    expect(engineNames.sort()).toEqual(factoryVideoIds.sort());
  });

  it('★ VideoGen MODEL_CAPS 覆盖全部工厂视频 id (否则时长/参考图被默认值砍半)', () => {
    const modelStoreSrc = rd('packages/agentai-gui/src/store/modelStore.ts');
    const factoryVideoIds = [...codeOnly(modelStoreSrc).matchAll(/\{ id: '(factory-seedance-[^']+)'/g)].map((m) => m[1]!);
    const capsKeys = [...codeOnly(videoGenSrc).matchAll(/'(factory-seedance-[^']+)':\s*SEEDANCE_CAPS/g)].map((m) => m[1]!);
    expect(capsKeys.sort()).toEqual(factoryVideoIds.sort());
  });

  it('★ 轮询端认 factory-seedance 前缀 (提交/轮询两端规则一致)', () => {
    expect(videoCode).toMatch(/provider\.startsWith\('factory-seedance'\)/);
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
    // 2026-10-20: 从 4 个内置扩到 8 个 (含工厂 4 变体)。
    // 源码里是两行字符串拼接, codeOnly 不合并跨行 → 分两段断言 (仍锁 8 个全列出)。
    expect(videoCode).toMatch(/agnes-video-2\.5 \/ agnes \/ cogvideo \/ seedance-2\.5/);
    expect(videoCode).toMatch(/factory-seedance-2\.5 \/ factory-seedance-2 \/ factory-seedance-2-fast \/ factory-seedance-2-mini/);
  });

  it('★ VideoGen MODELS 的工厂 value 与 modelStore 工厂 id 同一套 (2026-10-20 第四处硬编码契约)', () => {
    // 实锤: MODELS 的 value 曾是 doubao-seedance-* (上游真实名), 而 engineStatus[m.value]
    // 用 m.value 查后端 engines 目录 (factory-seedance-*) → 键名对不上, 灰显失效;
    // 用户选到的 doubao-seedance-2 在旧网关还报"未知的视频模型"。
    // 前端只传 id, 归一交给后端 normalizeSeedanceModel, 不能再引入第四套命名。
    const modelStoreSrc = rd('packages/agentai-gui/src/store/modelStore.ts');
    const factoryVideoIds = [...codeOnly(modelStoreSrc).matchAll(/\{ id: '(factory-seedance-[^']+)'/g)].map((m) => m[1]!);
    for (const id of factoryVideoIds) {
      expect(videoGenSrc, `VideoGen MODELS 缺 ${id}`).toContain("value: '" + id + "'");
    }
    expect(codeOnly(videoGenSrc), 'MODELS 的 value 不应再用上游真实名 doubao-seedance-*').not.toMatch(/value: 'doubao-seedance-/);
  });

  it('★ 前端提交时确实带上 model（否则后端无法按模型分发）', () => {
    expect(videoGenSrc).toMatch(/videoTaskManager\.submitTask\(\{[\s\S]{0,400}?model,/);
  });
});

describe('V5 分镜/视频 refImages 相对路径不再被误拼为非法 Data URI', () => {
  it('urlToBase64 有「/ 开头」分支：按 ?path= 参数解码后读本地文件', () => {
    expect(videoCode, '缺 / 开头分支 → 相对路径仍会被当 base64').toMatch(
      /startsWith\('\/'\)/,
    );
    expect(videoCode).toContain('[?&]path=([^&]+)');
    expect(videoCode).toMatch(/fs\.existsSync\(real\)/);
  });

  it('无法解析的 / 开头路径显式 throw，不再静默拼出非法 URI', () => {
    expect(videoCode).toMatch(/无法解析相对图片 URL/);
  });

  it('「纯 base64」分支有长度+字符集双重校验，不盲目补前缀', () => {
    expect(videoCode).toMatch(/trimmed\.length < 64/);
    expect(videoCode).toContain('A-Za-z0-9+');
  });

  it('★ 分支顺序正确：/ 开头判定先于 base64 兜底（防止回归重排）', () => {
    const slashBranch = videoCode.indexOf("trimmed.startsWith('/')");
    const b64Branch = videoCode.indexOf('trimmed.length < 64');
    expect(slashBranch, '/ 开头分支缺失').toBeGreaterThan(-1);
    expect(b64Branch, '纯 base64 分支缺失').toBeGreaterThan(-1);
    expect(slashBranch, '/ 开头分支必须在 base64 兜底之前').toBeLessThan(b64Branch);
  });

  it('★ storyboard 端点 refImages 统一走 urlToBase64，不再有盲拼 data: 前缀的旧代码', () => {
    expect(videoCode).toMatch(/await urlToBase64\(String\(img\)\)/);
    const blindConcat = (videoCode.match(/data:image\/png;base64,\$\{img\}/g) || []).length;
    expect(
      blindConcat,
      '旧盲拼代码 data:image/png;base64,${img} 应已删除',
    ).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// V6 Seedance/豆包 的尾帧经官方 API 取回 (2026-10-14)
//
// 旧缺陷: 只有 Agnes 两条查询分支解析尾帧; Seedance (火山直连 + Alrc 工厂)
// 既不请求也不解析 → 前端 lastFrameUrl 恒 undefined → 分镜「尾帧衔接」每次都
// 掉到 ffmpeg 兜底 (本机无 ffmpeg) → 空转。这批把尾帧接回来。
// ════════════════════════════════════════════════════════════════════════

describe('V6 Seedance 尾帧: 提交索要 + 查询解析', () => {
  it('★ 两条 Seedance 提交体都带 return_last_frame: true (工厂 + 火山直连)', () => {
    // 2026-10-20: 工厂改走官方 /video/generations (平台统一格式, 见 V8), 尾帧字段保留透传尝试。
    //   断言改成"函数体内出现该字段", 不再用脆弱的"200 字符内位置"匹配 ——
    //   注释一长就被顶出窗口, 假红比没测试更糟。
    const factoryFn = videoCode.slice(videoCode.indexOf('async function submitSeedanceViaFactory'));
    const volcanoFn = videoCode.slice(videoCode.indexOf('async function submitSeedanceVariant'));
    expect(factoryFn.slice(0, 2500), '工厂提交体缺少尾帧开关').toMatch(/return_last_frame = true|return_last_frame: true/);
    expect(volcanoFn.slice(0, 2500), '火山直连提交体缺少尾帧开关').toMatch(/return_last_frame: true/);
  });

  it('★ 四条查询分支 (2 Seedance + 2 Agnes) 的响应都带 lastFrameUrl', () => {
    const returns = (videoCode.match(/coverUrl, lastFrameUrl, raw: JSON\.stringify\(data\)/g) || []).length;
    expect(
      returns,
      'Seedance 工厂/火山 + Agnes 正式版/Flash 四条查询响应都应回传 lastFrameUrl',
    ).toBe(4);
  });

  it('★ 统一走 pickLastFrameUrl 容错解析 (各上游字段名不一)', () => {
    expect(videoCode, '缺少 pickLastFrameUrl 定义').toMatch(
      /function pickLastFrameUrl\(data: any\): string \| null/,
    );
    const uses = (videoCode.match(/const lastFrameUrl = pickLastFrameUrl\(data\)/g) || []).length;
    expect(uses, '四条查询分支都应改用该 helper').toBe(4);
    // 覆盖火山 Seedance 文档字段
    expect(videoCode).toContain('data.content?.last_frame_url');
    // 旧的 Agnes 内联三元已删除 (改走 helper)
    expect(videoCode).not.toContain('data.last_frame || data.last_frame_url');
  });

  it('★ 出视频却没解析到尾帧时打诊断日志 (只打字段名, 不打值/凭据)', () => {
    expect(videoCode).toMatch(/未解析到尾帧, 响应顶层字段/);
    expect(videoCode).toMatch(/Object\.keys\(data\)\.join\(','\)/);
  });
});

void NL;
// ════════════════════════════════════════════════════════════════════════
// V7 上游视频错误分类 (2026-10-20)
// 事故 (富哥实锤): 生视频"不论选哪个模型"都提示"队列已满" ——
//   ALRO 工厂返回 `HTTP 503:` (响应体为空), 网关 res.status(resp.status) 原样透传,
//   前端 `resp.status === 503` 就判队列满 → 盲重试 5 次 × 30s = 白等 2.5 分钟。
//   而上游 503 的性质完全不同 (繁忙 / 通道不支持 / 模型不可用 / 分组无权限),
//   一律当"队列满"重试 = 白等 + 误导。
// ════════════════════════════════════════════════════════════════════════
describe('V7 上游视频错误分类', () => {
  it('空响应体 503 → upstream_busy + 可重试, 且文案点明"无法区分繁忙/不可用"', { timeout: 20000 }, async () => {
    // 真调用 (不是源码文本断言): 该用例要 import 整个路由模块, 单独跑约 1.6s,
    // 并行时更慢 —— 显式放宽 timeout, 避免全量跑时被误判成失败。
    const { classifyUpstreamVideoError } = await import('./routes/video.js');
    const r = classifyUpstreamVideoError(503, '', { model: 'doubao-seedance-2', source: 'ALRO 工厂' });
    expect(r.code).toBe('upstream_busy');
    expect(r.retryable).toBe(true);
    expect(r.hint).toContain('响应体为空');
    expect(r.hint).toContain('doubao-seedance-2');
  });

  it('403 分组 → group_forbidden + **不可重试** (等再久也没用)', async () => {
    const { classifyUpstreamVideoError } = await import('./routes/video.js');
    const r = classifyUpstreamVideoError(403, '{"error":{"message":"无权访问 国内模型 分组"}}');
    expect(r.code).toBe('group_forbidden');
    expect(r.retryable).toBe(false);
    expect(r.hint).toMatch(/令牌/);
  });

  it('429 → rate_limited + 可重试; 404/400/未知 → 不可重试', async () => {
    const { classifyUpstreamVideoError } = await import('./routes/video.js');
    expect(classifyUpstreamVideoError(429, '').code).toBe('rate_limited');
    expect(classifyUpstreamVideoError(429, '').retryable).toBe(true);
    expect(classifyUpstreamVideoError(404, 'model_not_found').retryable).toBe(false);
    expect(classifyUpstreamVideoError(400, '').code).toBe('bad_request');
    expect(classifyUpstreamVideoError(418, '').retryable).toBe(false);
  });

  it('★ 四个引擎的错误透传都带 code + retryable + 诊断日志', () => {
    // 不带 code/retryable → 前端无法区分"该退避"还是"该立刻报错"
    const withCode = (videoCode.match(/code:\s*cls\.code/g) || []).length;
    expect(withCode, '工厂/火山/Agnes Flash/智谱 四处都应带 code').toBeGreaterThanOrEqual(4);
    const withRetryable = (videoCode.match(/retryable:\s*cls\.retryable/g) || []).length;
    expect(withRetryable).toBeGreaterThanOrEqual(4);
    // 上游失败必须留痕 (响应体为空时只有日志能事后定位)
    expect(videoCode).toMatch(/工厂 seedance 提交失败 status=/);
    expect(videoCode).toMatch(/视频引擎提交失败 status=/);
  });

  it('★ 前端不再用「任何 503 = 队列已满」判定退避', () => {
    const sb = codeOnly(storyboardSrc);
    const tm = codeOnly(taskManagerSrc);
    expect(sb, 'StoryboardPanel 仍有 resp.status === 503 判定').not.toMatch(/resp\.status === 503/);
    expect(tm, 'videoTaskManager 仍有 resp.status === 503 判定').not.toMatch(/resp\.status === 503/);
    // 改按后端给的 code / retryable 决定退避
    expect(sb).toMatch(/data\.retryable === true/);
    expect(sb).toMatch(/code === 'upstream_busy'/);
    expect(tm).toMatch(/data\.retryable === true/);
    // 不可重试时要显示真实原因 (error + hint), 不是干巴巴一个 HTTP 码
    expect(sb).toMatch(/\[data\.error, data\.hint\]/);
  });

  // ══════════════════════════════════════════════════════════════════════
  // V8 ALRO 工厂视频端点契约 (2026-10-20, 官方文档 + 真实 key 实测校准)
  // ══════════════════════════════════════════════════════════════════════
  it('★ 工厂视频提交/查询走官方端点, 不再打对话端点', async () => {
    // 实测: POST {base}/video/generations 接受 {model,prompt};
    //   GET  {base}/video/generations/{task_id} → result_url 取成片地址。
    //   旧实现打 /chat/completions (对话端点) → 无响应体 503。
    const fn = videoCode.slice(videoCode.indexOf('async function submitSeedanceViaFactory'));
    expect(fn.slice(0, 3000), '工厂提交应打 /video/generations').toContain('/video/generations');
    expect(fn.slice(0, 3000), '工厂提交不再打对话端点').not.toContain('/chat/completions');
    expect(fn.slice(0, 3000), '应解析官方 result_url 字段').toContain('result_url');
    expect(fn.slice(0, 3000), '提交体必填 model + prompt').toMatch(/model: subModel, prompt/);

    // 查询端: 官方端点排第一, 旧候选保留兜底
    const queryBlock = videoCode.slice(videoCode.indexOf("provider.startsWith('doubao-seedance')"));
    expect(queryBlock.slice(0, 1200)).toContain('/video/generations/${encodeURIComponent(taskId)}');
  });

  it('★ 503 + "No available channel" → 不可重试 (不是队列满)', async () => {
    // 实测: ALRO 对未开通渠道的模型返回 **HTTP 503** + code model_not_found
    //   + "No available channel ... under group default"。若按 503 退避重试,
    //   5×30s 全白等 —— 渠道不会因为等待而开通。
    const { classifyUpstreamVideoError } = await import('./routes/video.js');
    const r = classifyUpstreamVideoError(503, '{"code":"model_not_found","message":"No available channel for model doubao-seedance-2.5 under group default (distributor)"}');
    expect(r.code).toBe('model_unavailable');
    expect(r.retryable, '"没有可用渠道" 重试永远不会成功, 必须不可重试').toBe(false);
    expect(r.hint).toMatch(/渠道/);
  });
});
