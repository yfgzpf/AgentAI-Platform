/**
 * 媒资前后端契约回归测试 (生图 / 生视频 / 分镜, 2026-10-11)
 * ========================================================================
 * 这三块是核心版块, 但缺陷都属于「静默失效」型: UI 看上去一切正常,
 * 请求也发出去了, 只是打到了不存在的端点 / 参数名对不上 / 值被后端忽略。
 * 因此这里锁的是**请求契约**, 而不是渲染结果。
 *
 * 实测依据 (2026-10-11, 网关未重启亦可复现):
 *   curl "http://127.0.0.1:18789/v1/video/query?taskId=X&model=agnes"
 *     → 400 {"error":"无法识别 provider: (空)"}
 *   curl "http://127.0.0.1:18789/v1/video/X?provider=agnes"
 *     → 404 (来自上游 Agnes, 说明路由正确解析了 taskId)
 * 即: `/v1/video/query` 这个端点根本不存在, 会被 GET /v1/video/:taskId
 * 以 taskId='query' 吃掉, 且后端读的是 req.query.provider。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GUI = 'packages/agentai-gui';
const ROOT = resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(ROOT, GUI, 'src', p), 'utf-8');

/**
 * 去掉整行注释后再断言。
 * 必需: 这些文件的修复注释里会**引用**错误写法 (例如 "曾经打 /v1/video/query"),
 * 直接对原文正则会让注释把自己的负向断言顶掉。
 */
const stripComments = (code: string) =>
  code.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ════════════════════════════════════════════════════════════════════════
// 分镜 (StoryboardPanel) — 轮询契约
// ════════════════════════════════════════════════════════════════════════

describe('分镜: 视频任务轮询契约', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 不得再打不存在的 /v1/video/query', () => {
    expect(code).not.toContain('/v1/video/query');
  });

  it('★ 必须与 VideoGen / videoTaskManager 用同一契约: 路径参数 + provider', () => {
    expect(code).toMatch(/\/v1\/video\/\$\{encodeURIComponent\(taskId\)\}\?provider=/);
  });

  it('★ submitVideoTask 必须回传后端 provider, 前端不得自己猜引擎', () => {
    expect(code).toMatch(/taskId:\s*data\.taskId,\s*provider:\s*data\.provider/);
    // 曾经的猜测式映射: modelName === 'agnes-video-2.5' ? 'agnes-video-2.5' : 'agnes'
    expect(code).not.toMatch(/modelName === 'agnes-video-2\.5'/);
  });

  it('残留的 videoResult 拿到的是 provider, 不是 model 名', () => {
    const calls = code.match(/pollVideo\(result\.taskId,[^)]*\)/g) || [];
    expect(calls.length, '两处调用点 (单镜/批量) 都要传 provider').toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain('result.provider');
  });
});

describe('分镜: 续集尾帧', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ apiLastFrame 不得是恒 undefined 的占位表达式', () => {
    expect(code).not.toMatch(/videoUrl\s*\?\s*undefined\s*:\s*undefined/);
    expect(code).toMatch(/const apiLastFrame = lastShot\?\.lastFrameUrl/);
  });

  it('Shot 携带 lastFrameUrl, 且轮询结果写回镜次', () => {
    expect(code).toMatch(/lastFrameUrl\?:\s*string/);
    // 2026-10-14: 写回逻辑收敛进 withNewVersion (单镜/批量共用同一条追加版本的路径),
    // 断言从"两处内联写字段"改为"两条路径都调 withNewVersion, 且它写 lastFrameUrl"。
    const writes = code.match(/withNewVersion\(s, videoResult\)/g) || [];
    expect(writes.length, '单镜 + 批量两条路径都要写回').toBeGreaterThanOrEqual(2);
    expect(code).toContain('lastFrameUrl: vr.lastFrameUrl');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 分镜: 对白/独白送达 + 视频参数 + 缺图守卫 (2026-10-13)
// ════════════════════════════════════════════════════════════════════════
//
// 缺陷: 提交体是 { prompt: shot.prompt, ... }, shot.dialogue 生成后**从不进请求**,
// 用户看到台词却没有对应视频语音。参考 F:/漫剧系统 的 [Dialogue ...] 内联做法修复。

describe('分镜: 对白/独白内联进视频 prompt', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 必须有 buildSubmitPrompt, 把 dialogue/monologue 拼成带标签的文本', () => {
    expect(code).toMatch(/function buildSubmitPrompt\(shot: Shot\)/);
    expect(code).toContain('[Dialogue in Chinese');
    expect(code).toContain('[Inner monologue');
    // 音画同步指令 (与漫剧系统一致)
    expect(code).toContain('synchronized audio');
  });

  it('★ 提交体不得再直接发 shot.prompt (那条路径丢了台词)', () => {
    expect(code).not.toMatch(/prompt:\s*shot\.prompt,/);
    const used = code.match(/prompt:\s*buildSubmitPrompt\(shot\)/g) || [];
    expect(used.length, '单镜 + 批量两条提交路径都要用').toBeGreaterThanOrEqual(2);
  });

  it('★ monologue 是 Shot 的一等字段, 且可在镜卡里编辑', () => {
    expect(code).toMatch(/monologue\?:\s*string/);
    expect(code).toMatch(/updateShotField\([^)]*'monologue'/);
  });
});

describe('分镜: 视频参数不再写死', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 分辨率/宽高比改为受控状态, 提交时套用', () => {
    expect(code).toMatch(/useState\('720P'\)/);
    expect(code).toMatch(/const \[videoAspect, setVideoAspect\]/);
    expect(code).toMatch(/size:\s*videoSize, aspect_ratio:\s*videoAspect/);
  });

  it('★ 分镜提交路径不得再硬编码 720P / 16:9', () => {
    expect(code).not.toMatch(/size:\s*'720P'/);
    expect(code).not.toMatch(/aspect_ratio:\s*'16:9'/);
  });
});

describe('分镜: 缺图守卫 (未生成场景/角色图就生成视频)', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 有 findMissingRefs + guardMissingRefs, 单镜与批量都要过这道门', () => {
    expect(code).toMatch(/const findMissingRefs = /);
    expect(code).toMatch(/const guardMissingRefs = /);
    const guards = code.match(/await guardMissingRefs\(/g) || [];
    expect(guards.length, '单镜 + 批量两处').toBeGreaterThanOrEqual(2);
  });

  it('★ 提供「先补全再生成」并能把新图并入提交 (guard.extra)', () => {
    expect(code).toContain('先补全再生成');
    expect(code).toMatch(/collectRefImages\(epIdx, shot, guard\.extra,/);
    expect(code).toMatch(/const completeMissingRefs = /);
  });
});

describe('分镜: 剧本模型跟随所选', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));
  const gw = stripComments(gwSrc('routes/video.ts'));

  it('★ 前端把所选对话模型的 provider/子模型名发给 gateway', () => {
    expect(code).toContain('useModelStore');
    expect(code).toMatch(/scriptProvider, scriptModel: scriptModelName/);
  });

  it('★ gateway 两条剧本路径都接受 scriptProvider 并走 llm-router', () => {
    expect(gw).toContain('callScriptLLM');
    expect(gw).toContain('getAgentAIRouter');
    expect(gw).toMatch(/scriptProvider, scriptModel, systemPrompt/);
    // storyboard + next-episode 都取该参数
    const destructs = gw.match(/scriptProvider, scriptModel \} = req\.body/g) || [];
    expect(destructs.length, 'storyboard + next-episode 两处解构').toBeGreaterThanOrEqual(2);
  });

  it('★ 剧本提示词要求充分输出对白, 并含 monologue 字段', () => {
    expect(gw).toMatch(/"monologue":/);
    expect(gw).toContain('monologue 字段');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 生图 (ImageStudio) — 请求体契约
// ════════════════════════════════════════════════════════════════════════

describe('生图: /v1/image 请求体', () => {
  const code = stripComments(src('components/ImageStudio.tsx'));

  it('★ 必须发送 ratio (后端早支持, 前端此前从不发 → 出图恒 1:1)', () => {
    expect(code).toMatch(/const body: any = \{ prompt: finalPrompt, size, ratio, model, mode \}/);
  });

  it('★ 画幅选择器真的接上了常量 (ASPECT_RATIOS 不再是死代码)', () => {
    expect(code).toMatch(/options=\{ASPECT_RATIOS\}/);
    // 常量定义与引用都要在
    expect(code).toContain('const ASPECT_RATIOS');
  });

  it('★ 清晰度默认值必须落在 SIZES 的选项集合里', () => {
    expect(code).toMatch(/const \[size, setSize\] = useState\('1K'\)/);
    // SIZES 的值域
    expect(code).toMatch(/const SIZES = \[[\s\S]{0,200}'1K'[\s\S]{0,200}'2K'[\s\S]{0,200}'4K'/);
  });

  it('★ 「张数」不再是死控件: 前端串行补足, 且不再发无效的 n', () => {
    expect(code).toMatch(/const times = mode === 'text2img'/);
    expect(code).not.toMatch(/n:\s*batchCount/);
  });

  it('批次仅对文生图生效 (改图/换装是多轮语义, 不能被倍数放大)', () => {
    expect(code).toMatch(/Math\.max\(1, Math\.min\(4, batchCount\)\)/);
    expect(code).toContain('genOnce');
  });
});

// ════════════════════════════════════════════════════════════════════════
// 生视频 — 引擎可用性自检 + 限流重试 (2026-10-11)
// ════════════════════════════════════════════════════════════════════════
//
// 实测 (2026-10-11, POST /v1/video):
//   model=agnes-video-2.5 → 400 缺 AGNES_VIDEO_API_KEY
//   model=seedance-2.5    → 400 缺 VOLCANO_API_KEY
//   model=cogvideo        → 200 queued
//   model=agnes           → 429 「您已达到免费用户的 API 速率限制」 ← 用户口中的"队列满"
// 即 4 个引擎只有 1 个能跑, 而前端此前**完全无从知道** Key 配没配。

const GW = 'packages/agentai-gateway';
const gwSrc = (p: string) => readFileSync(join(ROOT, GW, 'src', p), 'utf-8');

describe('生视频: GET /v1/video/engines 可用性自检', () => {
  const code = stripComments(gwSrc('routes/video.ts'));

  it('★ engines 路由必须注册在 /v1/video/:taskId 之前 (否则被当成 taskId 吞掉)', () => {
    const enginesAt = code.indexOf("router.get('/v1/video/engines'");
    const taskIdAt = code.indexOf("router.get('/v1/video/:taskId'");
    expect(enginesAt, 'engines 端点缺失').toBeGreaterThan(-1);
    expect(taskIdAt).toBeGreaterThan(-1);
    expect(enginesAt, 'engines 在 :taskId 之后 → 会被 Express 吞掉').toBeLessThan(taskIdAt);
  });

  it('返回 available + requiredEnv, 前端才能提示该配哪个变量', () => {
    expect(code).toMatch(/available:\s*engineAvailable\(e\)/);
    expect(code).toMatch(/requiredEnv:\s*e\.env/);
  });

  it('★ 引擎表只有一处 (POST 自动选择与 engines 端点共用, 不得再写死第二份)', () => {
    expect(code).toContain('const VIDEO_ENGINES');
    expect(code).toMatch(/VIDEO_ENGINES\.filter\(engineAvailable\)/);
    // 原先 POST 处理器里的内联 candidates 数组应已删除
    expect(code).not.toMatch(/const candidates: Array<\{ name: string; env: string\[\] \}>/);
  });
});

describe('生视频: 前端不把用户送进必然 400 的引擎', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));

  it('拉取引擎可用性', () => {
    expect(gen).toContain('/v1/video/engines');
    expect(gen).toContain('isEngineAvailable');
  });

  it('★ 未配置 Key 的引擎在下拉里被禁用并标注', () => {
    expect(gen).toMatch(/disabled:\s*unavailable/);
    expect(gen).toContain('未配置 Key');
  });

  it('★ 两处自动切换都必须先查可用性 (原先无条件切到缺 Key 的正式版)', () => {
    const switches = gen.match(/setModel\('agnes-video-2\.5'\)/g) || [];
    const guards = gen.match(/isEngineAvailable\('agnes-video-2\.5'\)/g) || [];
    expect(switches.length, 'extract-frames + extract-tail 两处切换').toBe(2);
    expect(guards.length, `守卫数须与切换数一致 (${switches.length})`).toBe(switches.length);
    // 不得再有裸切换
    expect(gen).not.toMatch(
      /if \(model === 'cogvideo' \|\| model === 'agnes'\) \{\s*\n\s*setModel\('agnes-video-2\.5'\)/,
    );
  });
});

describe('生视频: 限流重试不得无限循环', () => {
  const code = stripComments(src('services/videoTaskManager.ts'));

  it('★ 重试有上限 (原先每次限流都 unshift 回队首 → 任务永远"排队中")', () => {
    expect(code).toContain('MAX_THROTTLE_RETRIES');
    expect(code).toMatch(/tries <= MAX_THROTTLE_RETRIES/);
  });

  it('429 也算限流 (原先只认 503, 429 被立刻标失败, 丢失退避机会)', () => {
    expect(code).toMatch(/resp\.status === 429/);
  });

  it('重试耗尽后落到 failed 并给出可执行的替代方案', () => {
    expect(code).toContain('仍被限流');
    expect(code).toContain('CogVideoX-Flash');
  });
});

describe('生视频: 引擎忽略的参数不得在 UI 上装作可调', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));
  const gw = stripComments(gwSrc('routes/video.ts'));

  it('★ 后端 submitCogVideo 确实不接收 seconds/size/aspectRatio (锁 UI 的依据)', () => {
    const sig = gw.match(/async function submitCogVideo\(([^)]*)\)/)?.[1];
    expect(sig, 'submitCogVideo 签名必须存在').toBeTruthy();
    expect(sig).not.toContain('seconds');
    expect(sig).not.toContain('aspectRatio');
    // 调用点同样不传 (res, key, prompt, image, end_frame)
    expect(gw).toContain('submitCogVideo(res, key, prompt, image, end_frame)');
  });

  it('★ cogvideo 标 ignoresParams, 时长标签变暗不可点', () => {
    expect(gen).toContain('ignoresParams: true');
    // CheckableTag 无 disabled prop → 必须用样式锁 (tsc 已证)
    expect(gen).toContain("pointerEvents: 'none'");
    const tags = gen.match(/style=\{lockedTagStyle\}/g) || [];
    expect(tags.length, 'DURATIONS 与 Seedance 两条渲染路径都要锁').toBe(2);
    expect(gen).toContain('由引擎决定 · 不可调');
  });

  it('★ 宽高比 Select 也锁 (原先完全开放, 但后端从不读它)', () => {
    expect(gen).toMatch(/disabled=\{!!getModelCaps\(model\)\.ignoresParams\} options=\{ASPECT_RATIOS\}/);
  });

  it('★ 预计耗时不再由无效的 duration 推导 (假精度)', () => {
    expect(gen).toContain("? '预计 2-4 分钟'");
  });
});

describe('生视频: 死代码 pollTask 不得复活', () => {
  const gen = stripComments(src('components/VideoGen.tsx'));

  it('本地 setInterval 轮询已删除, 轮询只在 videoTaskManager', () => {
    expect(gen).not.toMatch(/const pollTask = \(/);
    expect(gen).toContain("from '../services/videoTaskManager'");
  });
});

// ════════════════════════════════════════════════════════════════════
// 分镜: 跨剧本串味防护 + 左右栏拖拽 + 底部裁切 (2026-10-14)
// ════════════════════════════════════════════════════════════════════

describe('分镜: 异步生成结果不得串到别的剧本 (跨剧本 token 守卫)', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));
  const count = (s: string, sub: string) => s.split(sub).length - 1;

  it('★ 存在会话 token 基建 (sbTokenRef / bumpSbToken / sbWrite)', () => {
    expect(code).toContain('const sbTokenRef = React.useRef(0)');
    expect(code).toContain('const bumpSbToken = () => { sbTokenRef.current += 1; }');
    // sbWrite: 写入前比对 token —— token 不匹配 (已切剧本) 则**丢弃**, 绝不写进新剧本
    expect(code).toContain('const sbWrite = React.useCallback((token: number');
    expect(code).toContain('token !== sbTokenRef.current');
  });

  it('★ 所有异步写入都走 sbWrite(token, ...), 不再直接 setStoryboard', () => {
    // 直接写 (无 token 校验) 会让"在 A 剧本发起、切到 B 剧本后回填"落到 B —— 这就是串味根因
    expect(count(code, 'sbWrite(token,')).toBeGreaterThanOrEqual(12);
    // 旧的"裸写入"模式 (生成回调里直接 setStoryboard) 必须清零
    expect(code).not.toContain('setStoryboard(prev => { if (!prev) return prev;');
    expect(code).not.toContain('setStoryboard(prev => { if (!prev) return prev }');
  });

  it('★ 切换/新建/重生成/删除 剧本时推进 token (使在途回调立即失效)', () => {
    expect(count(code, 'bumpSbToken()')).toBeGreaterThanOrEqual(4);
  });

  it('★ 异步流程在关键点校验 token (中止/提前返回)', () => {
    // 批量/重试循环: token 变了就 break, 不再继续往新剧本写
    expect(code).toContain('if (sbTokenRef.current !== token) break;');
    // 单镜/角色图/场景图: token 变了就 return, 不弹"已生成"误导提示
    expect(code).toContain('if (sbTokenRef.current !== token) return;');
    expect(code).toContain('if (sbTokenRef.current !== token) return {');
  });
});

describe('分镜: 左右栏可拖拽 + 底部不被裁 (2026-10-14)', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ 根容器不能写 height:100% (在 VideoGen 的 flex 列里会顶破 → 底部被裁)', () => {
    expect(code).toContain("display: 'flex', gap: 12, flex: 1, minHeight: 0");
    expect(code).not.toContain("display: 'flex', gap: 12, height: '100%'");
  });

  it('★ 左栏拆两层: 外层 .page-pane 承载把手 (不滚), 内层单独滚动', () => {
    // 外层: 复用外壳/创作页同一套 .page-pane + PaneGrip (与对话页一致的拖拽体验)
    expect(code).toContain('className="page-pane page-pane--left"');
    expect(code).toContain('<PaneGrip resizable={sbLeftPane}');
    // 内层: 滚动容器独立存在
    expect(code).toContain("flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4");
  });

  it('★ 外层 .page-pane 不能再带 overflow:auto (否则 position:absolute 的把手随内容滚走 → 拖不到)', () => {
    expect(code).not.toContain("flexDirection: 'column', gap: 8, overflow: 'auto', paddingRight: 4");
  });
});

// ════════════════════════════════════════════════════════════════════
// 分镜: 单镜可反复生成, 结果作为候选版本归到当前剧集下 (2026-10-14)
// ════════════════════════════════════════════════════════════════════

describe('分镜: 单镜多版本候选 (生成不满意可继续生成)', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));
  const count = (s: string, sub: string) => s.split(sub).length - 1;

  it('★ Shot 带 videoVersions 候选历史; videoUrl 仍是"当前选用版"', () => {
    expect(code).toContain('export interface ShotVideoVersion');
    expect(code).toContain('videoVersions?: ShotVideoVersion[]');
    // 兼容语义: videoUrl 未删 (拼接/导出/预览都靠它取当前选用版)
    expect(code).toMatch(/videoUrl\?: string;/);
  });

  it('★ 生成成功 → 追加候选版本而不是覆盖 (单镜 + 批量各一处)', () => {
    expect(code).toContain('const withNewVersion = (s: Shot');
    expect(code).toContain('.slice(-MAX_SHOT_VERSIONS)');
    // 两条成功写入都必须走 withNewVersion
    expect(count(code, 'withNewVersion(s, videoResult)')).toBeGreaterThanOrEqual(2);
    // 旧的"覆盖式"写入必须清零
    expect(code).not.toContain("status: 'completed', videoUrl: videoResult.videoUrl, lastFrameUrl: videoResult.lastFrameUrl");
  });

  it('★ 已生成镜头按钮解禁 → 可"重新生成" (不再 disabled)', () => {
    // 按钮 disabled 只由 generating 决定
    expect(code).toContain("loading={shot.status === 'generating'} disabled={shot.status === 'generating'}");
    // 旧的"已生成即锁死"必须消失
    expect(code).not.toContain("shot.status === 'generating' || shot.status === 'completed'");
    // 标签改为可再次点击的"重新生成"
    expect(code).toContain("? '重新生成' : '生成'");
    expect(code).not.toContain("'已生成'");
  });

  it('★ 候选版本可按剧集对比/选用/删除 (归到当前剧集下)', () => {
    expect(code).toContain('const selectShotVersion = (epIdx: number, shotId: number, url: string)');
    expect(code).toContain('const removeShotVersion = (epIdx: number, shotId: number, url: string)');
    // 预览面板里每个镜头卡片带版本切换 (调用点在剧集内)
    expect(code).toContain('selectShotVersion(ep.index - 1, shot.id, ver.url)');
    // 删除当前选用版 → 自动顺延到剩余最后一版 (不能留下悬空 videoUrl)
    expect(code).toContain('const lastVer = next[next.length - 1]');
  });

  it('★ 候选版本持久化时清洗 URL (blob:/data: 落盘失效)', () => {
    expect(code).toContain('videoVersions: s.videoVersions?.filter(v => v.url?.startsWith(\'http\')');
  });
});

// ════════════════════════════════════════════════════════════════════
// 分镜: 尾帧衔接 — 上一镜尾帧当本镜首张参考图 + 跳镜询问 (2026-10-14)
// ════════════════════════════════════════════════════════════════════

describe('分镜: 尾帧衔接 (上一镜尾帧随参考图发送)', () => {
  const code = stripComments(src('components/StoryboardPanel.tsx'));

  it('★ Shot 携带 noContinuity 标记 + 面板有「尾帧衔接」开关 (默认开)', () => {
    expect(code).toContain('noContinuity?: boolean');
    expect(code).toContain('const [continuity, setContinuity] = useState(true)');
    expect(code).toContain('checked={continuity} onChange={setContinuity}');
  });

  it('★ 尾帧作为「第一张」参考图 (折中模式: 场景/角色图仍保留)', () => {
    // collectRefImages 新增 tail 参数
    expect(code).toContain('const collectRefImages = (epIdx: number, shot: Shot, extra?: RefExtras, tail?: string): string[] =>');
    // tail 必须**先于**场景图 push —— 引擎只取前 5 张, 尾帧要占住第一个位置
    expect(code).toContain('if (tail) refs.push(tail)');
    // ★ tail 在场景图之前: 断言顺序 (先 push(tail) 再 push(sceneUrl))
    //   注意源码是 CRLF, 不能用跨行 indexOf — 用单行锚点
    const iTail = code.indexOf('if (tail) refs.push(tail)');
    const iScene = code.indexOf('refs.push(sceneUrl)');
    expect(iTail).toBeGreaterThan(-1);
    expect(iScene).toBeGreaterThan(iTail);
  });

  it('★ guardContinuity: 上一镜有尾帧直接用; 集内首镜放行 (不算断链)', () => {
    expect(code).toContain('const guardContinuity = async (epIdx: number, shot: Shot)');
    // ① 已存尾帧 → 直接用, 不抽帧不弹窗
    expect(code).toContain('if (prevShot.lastFrameUrl) return { proceed: true, tail: prevShot.lastFrameUrl }');
    // 集内首镜 (idx<=0) → 没有上一镜可接 → 放行
    expect(code).toContain('if (!prevShot) return { proceed: true }');
  });

  it('★ 有视频无尾帧 → 现场抽帧 (POST /v1/video/extract-tail), 抽不到则静默降级', () => {
    expect(code).toContain('const extractTail = async (videoUrl: string)');
    expect(code).toContain('${httpUrl}/v1/video/extract-tail');
    // 抽帧接口失败(如服务器缺 ffmpeg → 500) 不再当"可恢复错误", 按抽不到处理
    expect(code).toContain('if (!resp.ok) return undefined;');
    // ★ 抽不到 → 静默降级 (上一镜已生成, 不该弹"先补上一镜"), 打 ⚠ 无衔接 标
    expect(code).toContain('return { proceed: true, skipped: true }');
    expect(code).toContain('tailUnavailableRef.current');
    expect(code).toContain('message.warning(');
    // 上一镜根本没生成 → 才弹窗 (无需 reason 参数, 只有这一种情形)
    expect(code).toContain('return askPrevNotReady(epIdx, prevShot.id);');
    // 旧的 'extract-failed' 弹窗路径必须清零 (那会把已生成的上一镜再烧一遍)
    expect(code).not.toContain("'extract-failed'");
  });

  it('★ 跳镜询问弹窗: 先补上一镜 / 跳过直接生成 / 取消 三选项', () => {
    expect(code).toContain('const askPrevNotReady = (epIdx: number, prevShotId: number');
    expect(code).toContain('先补上一镜 (推荐)');
    expect(code).toContain('跳过直接生成');
    // 「先补上一镜」→ 先把上一镜补生成, 本镜本次不生成 (完成后用户再点本镜接戏)
    expect(code).toContain('generateSingleShot(epIdx, prevShotId)');
    // 「跳过」→ 本镜照常生成但打 noContinuity 标
    expect(code).toContain('if (v === \'skip\') return resolve({ proceed: true, skipped: true })');
  });

  it('★ 单镜生成: 接上守卫 + 把尾帧并入参考图 + 跳过时打标', () => {
    expect(code).toContain('const cont = await guardContinuity(epIdx, shot)');
    expect(code).toContain('collectRefImages(epIdx, shot, guard.extra, cont.tail)');
    expect(code).toContain('noContinuity: !!cont.skipped');
    // 旧的三参调用必须清零 (否则尾帧根本没带进提交)
    expect(code).not.toContain('collectRefImages(epIdx, shot, guard.extra)');
  });

  it('★ 批量生成: 用 tailByShot 传「刚生成的尾帧」接戏, 无尾帧打标不弹窗', () => {
    expect(code).toContain('const tailByShot = new Map<number, string | undefined>()');
    // 批量内优先用本批刚生成的尾帧, 其次用已存的
    expect(code).toContain('tail = tailByShot.get(prevShot.id) ?? prevShot.lastFrameUrl');
    expect(code).toContain('collectRefImages(epIdx, shot, guard.extra, tail)');
    // 成功后把本镜尾帧存进 map, 供下一镜用
    expect(code).toContain('tailByShot.set(shot.id, videoResult.lastFrameUrl)');
    // 拿不到尾帧 → 打 noContinuity 标 (批量不弹窗, 避免几十镜逐个打断)
    expect(code).toContain('noContinuity: noCont');
  });

  it('★ 镜次行渲染「⚠ 无衔接」标记 (跳镜/抽帧失败时)', () => {
    expect(code).toContain('{shot.noContinuity && (');
    expect(code).toContain('⚠ 无衔接');
  });
});

