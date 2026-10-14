/**
 * StoryboardPanel — 剧本分镜面板 v2
 * ====================================================================
 * 布局: 左右分栏
 *   左侧: 角色/场景卡 + 分集分镜列表
 *   右侧: 生成结果预览
 *
 * 功能:
 * 1. 用户输入创意 + 选择集数 + 上传参考图 → 生成结构化剧本
 * 2. 角色卡独立区域 — 可 AI 生成定妆图 / 手动上传
 * 3. 分镜列表 — 可编辑/删除/勾选
 * 4. 批量生成 — 串行提交 (Flash 不支持并发)
 */

import React, { useState } from 'react';
import { Button, Input, InputNumber, Select, Card, Space, Tag, Tooltip, message, Spin, Progress, Collapse, Checkbox, Upload, Modal, Alert, Popover, Switch } from 'antd';
import {
  ThunderboltOutlined, DeleteOutlined, VideoCameraOutlined,
  PictureOutlined, PlusOutlined, UserOutlined, CameraOutlined, EditOutlined,
  FolderOutlined, FolderOpenOutlined, FileOutlined,
  EyeOutlined, ExportOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { SceneEditor } from './SceneEditor';
import { useResizable } from '../hooks/useResizable';
import { PaneGrip } from './PaneGrip';
// [BYOK] 自定义模型凭证 —— 与 VideoGen 共用同一份定义 (见文件头说明)
import { resolveByokCredential } from '../services/customVideoModels';
// 2026-10-13: 剧本生成跟随「对话所选模型」—— 读 modelStore 的 activeModelId
import { useModelStore } from '../store/modelStore';

const { TextArea } = Input;
const { Panel } = Collapse;

/** 2026-10-14: 单镜的一次生成结果 (候选版本) — 同一镜头可反复生成, 每版都留档归到当前剧集下 */
export interface ShotVideoVersion {
  url: string;
  /** API 返回的尾帧 — 续集功能用它跳过 ffmpeg 抽帧 */
  lastFrameUrl?: string;
  /** 生成时用的模型名 (便于回看哪版是什么模型出的) */
  model?: string;
  createdAt: number;
}

export interface Shot {
  id: number;
  type: string;
  duration: string;
  camera_motion: string;
  mood: string;
  prompt: string;
  characters: string[];
  dialogue: string;
  /** 2026-10-13 新增: 内心独白/旁白 (角色未出声的心声) — 与 dialogue 一起内联进视频 prompt 做音画同步 */
  monologue?: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  /** 当前选用的版本 (拼接/导出/预览都用它, 语义未变) */
  videoUrl?: string;
  /** API 返回的尾帧 (return_last_frame) — 续集功能用它跳过 ffmpeg 抽帧 */
  lastFrameUrl?: string;
  /**
   * 2026-10-14: 候选版本历史 — 单镜生成不满意可「重新生成」, 每次结果追加到这里 (不覆盖旧的),
   * `videoUrl` 始终指向其中被选用的那一版。全部候选按剧集归组展示, 供对比/选用/删除。
   */
  videoVersions?: ShotVideoVersion[];
  /**
   * 2026-10-14: 本镜生成时**没有接上上一镜尾帧** (上一镜未生成/尾帧提取失败, 用户选择了跳过)。
   * 仅用于在镜卡上打 ⚠ 提示, 让人知道这段是"独立生成、可能接不上戏"。
   */
  noContinuity?: boolean;
  error?: string;
  selected?: boolean;
}

export interface SceneCard {
  name: string;
  description: string;
  imageUrl?: string; // AI 生成的场景图
}

export interface Episode {
  index: number;
  title: string;
  shots: Shot[];
  scene?: SceneCard; // 每集的场景卡 — 保证跨集场景一致
}

export interface StoryboardCharacter {
  name: string;
  description: string;
  refImageIndex?: number;
  portraitUrl?: string; // 定妆图 — 单人白底全身照, 用于精编抠图
  sheetUrl?: string;    // 九宫格 — 多角度参考图, 用于AI理解角色特征
}

export interface Storyboard {
  title: string;
  characters: StoryboardCharacter[];
  episodes: Episode[];
}

export interface StoryboardPanelProps {
  httpUrl: string;
  refImages: string[];
  model: string;
}

// ===== 角色库 (跨剧本复用) =====
const CHAR_LIBRARY_KEY = 'agentai-character-library';

// 2026-10-14: 单镜候选版本上限 — 反复重生成时只保留最近 N 版, 防 localStorage 膨胀
const MAX_SHOT_VERSIONS = 6;
interface CharLibEntry {
  name: string;
  description: string;
  portraitUrl?: string;
  sheetUrl?: string;
  savedAt: number;
}
function loadCharLibrary(): CharLibEntry[] {
  try { const raw = localStorage.getItem(CHAR_LIBRARY_KEY); if (raw) return JSON.parse(raw); } catch {}
  return [];
}
function saveToCharLibrary(char: StoryboardCharacter) {
  if (!char.portraitUrl) return; // 没有定妆图不入库
  try {
    const lib = loadCharLibrary();
    const idx = lib.findIndex(c => c.name === char.name);
    const entry: CharLibEntry = {
      name: char.name, description: char.description,
      portraitUrl: char.portraitUrl?.startsWith('http') || char.portraitUrl?.startsWith('/api/') ? char.portraitUrl : undefined,
      sheetUrl: char.sheetUrl?.startsWith('http') || char.sheetUrl?.startsWith('/api/') ? char.sheetUrl : undefined,
      savedAt: Date.now(),
    };
    if (idx >= 0) lib[idx] = entry; else lib.push(entry);
    localStorage.setItem(CHAR_LIBRARY_KEY, JSON.stringify(lib));
  } catch {}
}

/**
 * 2026-10-13: 把镜头组装成最终提交给视频模型的 prompt。
 *
 * 【为什么需要】原实现提交体只有 `prompt: shot.prompt`, **shot.dialogue 生成后
 * 从不进请求** —— 用户在分镜页看到「台词: "…"」, 视频里却没有任何对白/口型。
 * 参考 F:/漫剧系统 里验证过的做法 (complete_ming_drama.py:92 / ming_dynasty_agnes.py:247):
 * 用带标签的文本驱动模型做音画同步 —— 台词进 [Dialogue ...], 并显式要求对口型。
 *
 * @param shot 分镜镜头
 * @returns 拼接后的完整 prompt (含对白/独白/运镜/氛围)
 */
export function buildSubmitPrompt(shot: Shot): string {
  const parts = [(shot.prompt || '').trim()];
  if (shot.camera_motion) parts.push(`[Camera motion] ${shot.camera_motion}`);
  if (shot.mood) parts.push(`[Mood] ${shot.mood}`);
  const dialogue = (shot.dialogue || '').trim();
  const monologue = (shot.monologue || '').trim();
  if (dialogue) parts.push(`[Dialogue in Chinese, character speaks: "${dialogue}"]`);
  if (monologue) parts.push(`[Inner monologue / voiceover in Chinese: "${monologue}"]`);
  if (dialogue || monologue) {
    // 音画同步指令 —— 与漫剧系统一致, 明确要求口型匹配
    parts.push('Generate synchronized audio: the spoken lines must match the on-screen character lip movement and natural voice tone.');
  }
  return parts.filter(Boolean).join('\n');
}

/** 一键补全时新生成的参考图 (按场景集号 / 角色名索引), 直接并入提交, 不依赖 setState 时序 */
export interface RefExtras {
  scenes: Record<number, string>;
  chars: Record<string, string>;
}

// 右侧折叠面板的 CSS — 折叠时只显示 header, 展开时自动填充
const RIGHT_COLLAPSE_CSS = `.storyboard-right-collapse .ant-collapse-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.storyboard-right-collapse .ant-collapse-content-box {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 8px !important;
}
`;

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({ httpUrl, refImages, model }) => {
  const [prompt, setPrompt] = useState('');
  const [episodeCount, setEpisodeCount] = useState(3);
  const [shotDuration, setShotDuration] = useState(5);
  const [generating, setGenerating] = useState(false);

  // ===== 2026-10-13: 视频生成参数 (与单次生成页对齐) =====
  // 原实现提交体写死 size:'720P' / aspect_ratio:'16:9', 页面上没有任何分辨率控件。
  const [videoSize, setVideoSize] = useState('720P');
  const [videoAspect, setVideoAspect] = useState('16:9');

  // ===== 2026-10-13: 剧本模型跟随「对话所选模型」=====
  // 原来 gateway 写死 agnes-2.5-flash (免费档, 对白稀疏)。现在把用户在聊天页选的
  // 模型 (modelStore.activeModelId) 的 provider + 子模型名传给 /v1/video/storyboard,
  // 由 gateway 的 llm-router 解析 baseURL/keyEnv。未选到配置时回落到免费模型。
  const activeModelId = useModelStore(s => s.activeModelId);
  const modelStoreModels = useModelStore(s => s.models);
  const scriptModelCfg = modelStoreModels.find(m => m.id === activeModelId);
  const scriptProvider = scriptModelCfg?.provider;
  const scriptModelName = scriptModelCfg?.models?.[0] || activeModelId || undefined;

  // ===== 2026-10-13: 缺图守卫 =====
  // 未生成场景图/角色定妆图就生成视频时, 一致性参考图会缺失 → 白生成。弹窗提示 + 一键补全。
  const [missingPrompt, setMissingPrompt] = useState<null | {
    scenes: number[]; chars: string[]; resolve: (r: { proceed: boolean; extra?: RefExtras }) => void;
  }>(null);
  const [completingRefs, setCompletingRefs] = useState(false); // 「先补全再生成」进行中

  // ===== 2026-10-14: 尾帧衔接 (接戏) =====
  // 场景图/角色图只保证"同人同景" (像), 保证不了动作接续 (顺)。
  // 每镜生成时把**上一镜的尾帧**作为本镜的第一个参考图发下去, 让画面能接着上一镜。
  // 默认开; 换场/换景/蒙太奇时可关。
  const [continuity, setContinuity] = useState(true);
  // 上一镜**还没生成**时的弹窗 — 问是否先补上一镜 (只有这一种情形弹窗)
  const [continuityPrompt, setContinuityPrompt] = useState<null | {
    epIdx: number; prevShotId: number;
    resolve: (v: 'fill' | 'skip' | 'cancel') => void;
  }>(null);
  // 2026-10-14: 尾帧"取不到"只提示一次 — 服务器没装 ffmpeg 时每镜都会失败,
  //   逐个弹窗/刷提示会把面板淹掉。这里降级为静默 + 首次警告一次。
  const tailUnavailableRef = React.useRef(false);

  // ===== 多剧本持久化 =====
  // localStorage 结构: agentai-storyboards = { list: [{id,title,updatedAt}], activeId }
  // 每个剧本数据单独存: agentai-storyboards-{id}
  const STORAGE_KEY = 'agentai-storyboards';
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw).activeId || null; } catch {}
    return null;
  });
  const [storyboardList, setStoryboardList] = useState<{ id: string; title: string; updatedAt: number }[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw).list || []; } catch {}
    return [];
  });
  const [storyboard, setStoryboard] = useState<Storyboard | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.activeId && parsed.list) {
          const item = parsed.list.find((s: any) => s.id === parsed.activeId);
          if (item?.id) {
            const dataRaw = localStorage.getItem(`${STORAGE_KEY}-${item.id}`);
            if (dataRaw) {
              const data = JSON.parse(dataRaw);
              // 补全 scene 字段 (旧剧本可能没有)
              if (data?.episodes) {
                for (const ep of data.episodes) {
                  if (!ep.scene) {
                    ep.scene = {
                      name: `第${ep.index}集场景`,
                      description: ep.shots?.[0]?.prompt?.slice(0, 100) || '',
                    };
                  }
                }
              }
              // ★ 2026-10-12 P0 修复: 持久化时 shot.status 原样存了 'generating',
              //   恢复时不重置 → L954 按钮 disabled={status==='generating'} 永久锁死,
              //   该镜头刷新后再也点不动。对齐 imageTaskManager.ts L80-87 的恢复重置逻辑。
              if (Array.isArray(data?.episodes)) {
                for (const ep of data.episodes) {
                  if (Array.isArray(ep?.shots)) {
                    for (const s of ep.shots) {
                      if (s.status === 'generating' || s.status === 'queued') s.status = 'pending';
                    }
                  }
                }
              }
              return data;
            }
          }
        }
      }
    } catch {}
    return null;
  });
  const [merging, setMerging] = useState<number | null>(null); // 正在拼接的集号

  // storyboard 变化时自动保存
  React.useEffect(() => {
    if (!storyboard) return;
    const id = activeId || `sb-${Date.now()}`;
    const toSave: Storyboard = {
      ...storyboard,
      characters: storyboard.characters.map(c => ({ ...c, portraitUrl: c.portraitUrl?.startsWith('data:') ? undefined : c.portraitUrl })),
      episodes: storyboard.episodes.map(ep => ({
        ...ep,
        shots: ep.shots.map(s => ({
          ...s,
          videoUrl: s.videoUrl?.startsWith('http') || s.videoUrl?.startsWith('/api/') ? s.videoUrl : undefined,
          // 2026-10-14: 候选版本同样只留可用 URL (blob:/data: 之类落盘后失效)
          videoVersions: s.videoVersions?.filter(v => v.url?.startsWith('http') || v.url?.startsWith('/api/')),
        })),
        scene: ep.scene ? { ...ep.scene, imageUrl: ep.scene.imageUrl?.startsWith('http') || ep.scene.imageUrl?.startsWith('/api/') ? ep.scene.imageUrl : undefined } : undefined,
      })),
    };
    // 保存剧本数据到独立 key
    try { localStorage.setItem(`${STORAGE_KEY}-${id}`, JSON.stringify(toSave)); } catch {
      // 溢出 — 精简保存
      try {
        const minimal = {
          title: storyboard.title,
          characters: storyboard.characters.map(c => ({ name: c.name, description: c.description })),
          episodes: storyboard.episodes.map(ep => ({
            index: ep.index, title: ep.title,
            shots: ep.shots.map(s => ({ ...s, videoUrl: s.videoUrl?.startsWith('http') ? s.videoUrl : undefined, videoVersions: undefined })),
          })),
        };
        localStorage.setItem(`${STORAGE_KEY}-${id}`, JSON.stringify(minimal));
      } catch {}
    }
    // 更新列表
    setStoryboardList(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const entry = { id, title: storyboard.title, updatedAt: Date.now() };
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [...prev, entry];
    });
    if (!activeId) setActiveId(id);
    // 更新索引
    try {
      const idxRaw = localStorage.getItem(STORAGE_KEY);
      const idx = idxRaw ? JSON.parse(idxRaw) : { list: [], activeId: null };
      const listEntry = { id, title: storyboard.title, updatedAt: Date.now() };
      const list = idx.list || [];
      const li = list.findIndex((s: any) => s.id === id);
      if (li >= 0) list[li] = listEntry; else list.push(listEntry);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ list, activeId: id }));
    } catch {}
  }, [storyboard]);

  // 切换剧本
  const switchStoryboard = (id: string) => {
    bumpSbToken(); // ★ 换剧本 → 在途生成的写入全部作废
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}-${id}`);
      if (raw) {
        const data = JSON.parse(raw);
        // 补全 scene 字段 (旧剧本可能没有)
        if (data?.episodes) {
          for (const ep of data.episodes) {
            if (!ep.scene) {
              ep.scene = {
                name: `第${ep.index}集场景`,
                description: ep.shots?.[0]?.prompt?.slice(0, 100) || '',
              };
            }
          }
        }
        // ★ 2026-10-12 P0 修复: 与 useState 初始化同一套重置 —— 切换剧本同样会
        //    读到 'generating' 状态的镜头, 不重置则按钮永久锁死
        if (Array.isArray(data?.episodes)) {
          for (const ep of data.episodes) {
            if (Array.isArray(ep?.shots)) {
              for (const s of ep.shots) {
                if (s.status === 'generating' || s.status === 'queued') s.status = 'pending';
              }
            }
          }
        }
        setActiveId(id);
        setStoryboard(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: storyboardList, activeId: id }));
        message.success(`已切换到: ${data.title}`);
      }
    } catch { message.error('切换失败'); }
  };

  // 2026-10-12 B-4: 一键重试所有失败镜头 — 串行复用单镜生成, 不碰 batchGenerate 状态机
  const retryFailedShots = async () => {
    if (!storyboard) return;
    const failed = storyboard.episodes.flatMap((ep, epIdx) =>
      ep.shots.filter(s => s.status === 'failed').map(s => ({ epIdx, shotId: s.id })));
    if (failed.length === 0) return;
    const token = sbTokenRef.current; // ★ 换剧本即停止重试
    message.info(`开始重试 ${failed.length} 个失败镜头 (串行)...`);
    for (const f of failed) {
      if (sbTokenRef.current !== token) break; // 用户已切换剧本 → 中止
      await generateSingleShot(f.epIdx, f.shotId);
      // 镜间留 1s, 避免连续打满触发限流
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // 删除剧本
  const deleteStoryboard = (id: string) => {
    if (id === activeId) bumpSbToken(); // ★ 删的是当前剧本 → 在途生成的写入作废
    setStoryboardList(prev => {
      const next = prev.filter(s => s.id !== id);
      localStorage.removeItem(`${STORAGE_KEY}-${id}`);
      if (id === activeId) {
        if (next.length > 0) {
          const first = next[0];
          setActiveId(first.id);
          try { const raw = localStorage.getItem(`${STORAGE_KEY}-${first.id}`); if (raw) setStoryboard(JSON.parse(raw)); } catch { setStoryboard(null); }
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: next, activeId: first.id }));
        } else {
          setActiveId(null);
          setStoryboard(null);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: [], activeId: null }));
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: next, activeId }));
      }
      return next;
    });
    message.success('已删除');
  };

  // 新建剧本 — 不覆盖旧的, 先保存当前再清空
  const newStoryboard = () => {
    bumpSbToken(); // ★ 新建 = 换剧本 → 在途生成的写入全部作废
    setStoryboard(null);
    setActiveId(null);
    setPrompt('');
    message.info('已新建空白剧本, 输入创意后生成');
  };
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  // 2026-10-12: 批量取消标志 (原循环无出口, 只能等完或刷新)
  const [batchCancelled, setBatchCancelled] = useState(false);
  const [generatingPortrait, setGeneratingPortrait] = useState<string | null>(null);
  const [generatingScene, setGeneratingScene] = useState<number | null>(null); // epIdx
  const [zoomPortrait, setZoomPortrait] = useState<{ url: string; name: string } | null>(null);
const [zoomScene, setZoomScene] = useState<{ url: string; name: string } | null>(null);
const [generatingSequel, setGeneratingSequel] = useState<number | null>(null); // 正在生成续集的集号
const [editingScene, setEditingScene] = useState<number | null>(null); // 正在精编的集号
// 右侧面板折叠状态 — ✅ 批次9: 默认展开预览 (原默认 [] 折叠 → 左栏 620px 固定,
// 右栏 display:none, 剩下全黑 = "半屏黑洞"回归)。现在默认 preview, 编辑区窄一点但不再黑洞。
const [rightPanelExpanded, setRightPanelExpanded] = useState<string[]>(['preview']); // ['preview'] / ['export'] / 两者
  // 2026-10-12 C 批次: 左栏宽度可拖拽 + localStorage 记忆
  // 原为 width: '55%' | '100%' 写死跳变 — 不能拖、不记忆、无窄屏兜底。
  // 右栏展开时左栏宽度不变 (只是右栏从 flex 剩余空间里挤进来), 符合"展开预览不压缩编辑区"的直觉。
  const sbLeftPane = useResizable({
    storageKey: 'agentai.storyboard.leftW',
    defaultWidth: 620, minWidth: 380, maxWidth: 900, side: 'right',
  });

  // ★ 2026-10-14 P0 修复: 剧本会话令牌 —— 修复「切换剧本后, 在途生成的视频写进新剧本」。
  //   根因: 所有异步回调都用 `setStoryboard(prev => ... s.id === shotId ...)` 定位镜头, 而
  //   shot.id 是**每集从 1 重新开始**的小整数 (gateway 生成 schema 与续集兜底都是 id:1,2,3…,
  //   见 routes/video.ts:894 / :980 / :1095)。跨剧本必然撞号 →
  //   用户在剧本 A 发起生成, 切到剧本 B 后, A 的回调仍按 id 命中 B 的同号镜头,
  //   于是 B 出现"A 的视频" + 假的「已生成」标记, 还会被自动保存 effect 落盘。
  //   令牌在 切换/新建/重新生成/删除 剧本时自增; 异步流程启动时快照该值,
  //   写入时若值已变 (= 用户换了剧本) 则整条丢弃, 不污染当前剧本。
  const sbTokenRef = React.useRef(0);
  const bumpSbToken = () => { sbTokenRef.current += 1; };
  const sbWrite = React.useCallback((token: number, fn: (sb: Storyboard) => Storyboard) => {
    setStoryboard(prev => (prev === null || token !== sbTokenRef.current) ? prev : fn(prev));
  }, []);

  // 生成剧本
  const generateStoryboard = async () => {
    if (!prompt.trim()) { message.warning('请输入创意描述'); return; }
    setGenerating(true);
    try {
      const resp = await fetch(`${httpUrl}/v1/video/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, episodeCount, durationPerShot: String(shotDuration), refImages, scriptProvider, scriptModel: scriptModelName }),
      });
      const data = await resp.json();
      if (data.error) { message.error('剧本生成失败: ' + data.error); return; }
      if (data.ok && data.storyboard) {
        const sb = data.storyboard as Storyboard;
        sb.episodes.forEach(ep => ep.shots.forEach(s => { s.selected = true; s.status = 'pending'; }));
        // 生成新剧本时清除 activeId, 让 useEffect 创建新条目而非覆盖当前
        bumpSbToken(); // ★ 重新生成 = 换剧本 → 在途生成的写入全部作废
        setActiveId(null);
        setStoryboard(sb);
        message.success(`✅ 剧本已生成: ${sb.title}`);
      }
    } catch (e: any) { message.error('剧本生成失败: ' + e.message); }
    finally { setGenerating(false); }
  };

  // AI 生成角色图 — 同时生成定妆图(白底单人照, 用于精编抠图) + 九宫格(多角度参考, 用于AI理解角色)
  // 2026-10-13: 返回值 = 本次生成的图 URL (供「缺图守卫」一键补全时直接并入提交, 不依赖 state 时序)
  const generatePortrait = async (charName: string): Promise<{ portraitUrl?: string; sheetUrl?: string } | undefined> => {
    if (!storyboard) return;
    const char = storyboard.characters.find(c => c.name === charName);
    if (!char) return;
    const token = sbTokenRef.current; // 绑定当前剧本会话
    setGeneratingPortrait(charName);
    try {
      // 定妆图 prompt — 单人正面全身照, 白底, 适合抠图
      const portraitPrompt = `Full body portrait of a single character: ${char.description}. 
Standing facing forward, arms at sides, neutral pose. 
Plain solid white background, studio lighting, no shadows on background. 
Character centered in frame, full body visible from head to toe. 
Photorealistic style, high detail, professional photography quality. 
The character is the ONLY subject in the image, no other people or objects.`;
      // 九宫格 prompt — 多角度参考图, 帮助 AI 从不同角度理解角色特征
      const sheetPrompt = `Character design sheet of ${char.description}. 
A 3x3 grid showing 9 different camera angles of the SAME character: 
top row: front view, three-quarter view, side profile view; 
middle row: back view, three-quarter back view, looking up view; 
bottom row: looking down view, close-up face, full body standing pose. 
Consistent character design across all 9 views — same face, same hair, same clothing, same body type. 
White background, character sheet reference, concept art style, high detail, professional quality.`;

      // 同时发送两个请求
      const [portraitResp, sheetResp] = await Promise.all([
        fetch(`${httpUrl}/v1/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: portraitPrompt, model: 'agnes', mode: 'text2img', size: '2K' }),
        }),
        fetch(`${httpUrl}/v1/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: sheetPrompt, model: 'agnes', mode: 'text2img', size: '2K' }),
        }),
      ]);

      const portraitData = await portraitResp.json();
      const sheetData = await sheetResp.json();

      const portraitUrl = portraitData.url?.startsWith('/') ? httpUrl + portraitData.url : portraitData.url;
      const sheetUrl = sheetData.url?.startsWith('/') ? httpUrl + sheetData.url : sheetData.url;

      sbWrite(token, prev => ({
        ...prev,
        characters: prev.characters.map(c => c.name === charName
          ? { ...c, portraitUrl: portraitUrl || c.portraitUrl, sheetUrl: sheetUrl || c.sheetUrl }
          : c
        ),
      }));

      // 自动保存到角色库 (跨剧本复用)
      if (portraitUrl) {
        saveToCharLibrary({ ...char, portraitUrl, sheetUrl: sheetUrl || char.sheetUrl });
      }

      // 剧本已切换时不再弹「已生成」, 避免误导用户以为当前剧本生成成功
      if (sbTokenRef.current !== token) return { portraitUrl: portraitUrl || undefined, sheetUrl: sheetUrl || undefined };
      const okCount = (portraitUrl ? 1 : 0) + (sheetUrl ? 1 : 0);
      if (portraitData.error && sheetData.error) {
        message.error(`角色图生成失败: ${portraitData.error}`);
      } else {
        message.success(`✅ ${charName} 角色图已生成 (${okCount}/2 成功${portraitUrl ? ' · 定妆图' : ''}${sheetUrl ? ' · 九宫格' : ''})`);
      }
      return { portraitUrl: portraitUrl || undefined, sheetUrl: sheetUrl || undefined };
    } catch (e: any) { message.error('角色图生成失败: ' + e.message); return undefined; }
    finally { setGeneratingPortrait(null); }
  };

  // 上传角色定妆图
  const uploadPortrait = (charName: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setStoryboard(prev => {
        if (!prev) return prev;
        return { ...prev, characters: prev.characters.map(c => c.name === charName ? { ...c, portraitUrl: url } : c) };
      });
    };
    reader.readAsDataURL(file);
  };

  // AI 生成场景图 — 每集一个场景, 保证跨集场景一致
  // 2026-10-13: 返回值 = 生成的场景图 URL (供缺图守卫一键补全直接并入提交)
  const generateSceneImage = async (epIdx: number): Promise<string | undefined> => {
    if (!storyboard) return undefined;
    const ep = storyboard.episodes[epIdx];
    if (!ep || !ep.scene) return undefined;
    const token = sbTokenRef.current; // 绑定当前剧本会话
    setGeneratingScene(epIdx);
    try {
      const scenePrompt = `Photorealistic scene background ONLY: ${ep.scene.description}. 
ABSOLUTELY NO PEOPLE, NO CHARACTERS, NO HUMANS, NO FACES, NO FIGURES — environment and architecture only.
Empty room, empty landscape, empty street — no living beings visible.
Wide establishing shot, cinematic lighting, natural colors, realistic photography style.
High detail, professional quality, 16:9 aspect ratio.`;
      const resp = await fetch(`${httpUrl}/v1/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: scenePrompt, model: 'agnes', mode: 'text2img', size: '2K' }),
      });
      const data = await resp.json();
      if (data.error) { message.error(`场景图生成失败: ${data.error}`); return undefined; }
      const url = data.url?.startsWith('/') ? httpUrl + data.url : data.url;
      sbWrite(token, prev => {
        const eps = [...prev.episodes];
        eps[epIdx] = { ...eps[epIdx], scene: { ...eps[epIdx].scene!, imageUrl: url } };
        return { ...prev, episodes: eps };
      });
      if (sbTokenRef.current === token) message.success(`✅ 第${epIdx + 1}集场景图已生成`);
      return url || undefined;
    } catch (e: any) { message.error('场景图生成失败: ' + e.message); return undefined; }
    finally { setGeneratingScene(null); }
  };

  // 智能续集 — 基于上一集剧情+尾帧, AI 生成新的分镜剧本
  const generateSequel = async (fromEpIdx: number) => {
    if (!storyboard) return;
    const ep = storyboard.episodes[fromEpIdx];
    if (!ep) return;
    const token = sbTokenRef.current; // 绑定当前剧本会话
    // 收集上一集剧情: 所有镜头的 prompt
    const epPrompts = ep.shots.map(s => s.prompt).join('\n');
    // 获取最后一镜的尾帧 URL — 有 API 尾帧就免去 ffmpeg 抽帧 (后端 next-episode 优先用它)
    const lastShot = ep.shots[ep.shots.length - 1];
    const apiLastFrame = lastShot?.lastFrameUrl;

    setGeneratingSequel(fromEpIdx);
    try {
      const resp = await fetch(`${httpUrl}/v1/video/next-episode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: lastShot?.videoUrl,
          originalPrompt: epPrompts,
          episodeIndex: fromEpIdx + 2, // 下一集编号
          characters: storyboard.characters.map(c => ({ name: c.name, description: c.description })),
          storyContext: `剧名: ${storyboard.title}, 已完成 ${fromEpIdx + 1} 集`,
          apiLastFrame,
          scriptProvider, scriptModel: scriptModelName,
        }),
      });
      const data = await resp.json();
      if (data.error) { message.error(`续集生成失败: ${data.error}`); return; }

      const epData = data.episodeData;
      if (!epData?.episode) { message.error('续集数据异常'); return; }

      // 合并新角色 (去重)
      const existingNames = new Set(storyboard.characters.map(c => c.name));
      const newChars = (epData.characters || []).filter((c: any) => !existingNames.has(c.name));

      // 追加新集到 storyboard
      const newEpisode: Episode = {
        index: storyboard.episodes.length + 1,
        title: epData.episode.title || `第${storyboard.episodes.length + 1}集`,
        shots: epData.episode.shots.map((s: any, i: number) => ({
          ...s,
          id: i + 1,
          selected: true,
          status: 'pending',
        })),
        scene: epData.episode.scene,
      };

      sbWrite(token, prev => ({
        ...prev,
        characters: [...prev.characters, ...newChars],
        episodes: [...prev.episodes, newEpisode],
      }));

      if (sbTokenRef.current === token) message.success(`✅ 智能续集已生成: ${newEpisode.title} (${newEpisode.shots.length} 镜)${data.warning ? '\n⚠️ ' + data.warning : ''}`);
    } catch (e: any) { message.error('续集生成失败: ' + e.message); }
    finally { setGeneratingSequel(null); }
  };

  // 更新单镜提示词
  const updateShotPrompt = (epIdx: number, shotId: number, newPrompt: string) => {
    setStoryboard(prev => {
      if (!prev) return prev;
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, prompt: newPrompt } : s);
      return { ...prev, episodes: eps };
    });
  };

  // 2026-10-13: 台词/独白可编辑 — 生成后常需微调, 且它俩会内联进提交给视频模型的 prompt
  const updateShotField = (epIdx: number, shotId: number, field: 'dialogue' | 'monologue', value: string) => {
    setStoryboard(prev => {
      if (!prev) return prev;
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, [field]: value } : s);
      return { ...prev, episodes: eps };
    });
  };

  const toggleShot = (epIdx: number, shotId: number) => {
    setStoryboard(prev => {
      if (!prev) return prev;
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, selected: !s.selected } : s);
      return { ...prev, episodes: eps };
    });
  };

  const deleteShot = (epIdx: number, shotId: number) => {
    setStoryboard(prev => {
      if (!prev) return prev;
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.filter(s => s.id !== shotId);
      return { ...prev, episodes: eps };
    });
  };

  // 2026-10-14: 生成成功 → 把本次结果**追加**为候选版本 (不覆盖旧版),
  // 并让 videoUrl 指向最新一版 (即"刚生成的那版"默认选用)。超过上限则丢弃最旧的。
  const withNewVersion = (s: Shot, vr: { videoUrl: string; lastFrameUrl?: string }): Shot => ({
    ...s,
    status: 'completed',
    videoUrl: vr.videoUrl,
    lastFrameUrl: vr.lastFrameUrl,
    error: undefined,
    videoVersions: [
      ...(s.videoVersions || []),
      { url: vr.videoUrl, lastFrameUrl: vr.lastFrameUrl, model, createdAt: Date.now() } as ShotVideoVersion,
    ].slice(-MAX_SHOT_VERSIONS),
  });

  // 选用某一版候选作为该镜头的当前版本 (拼接/导出/预览随之更新)
  const selectShotVersion = (epIdx: number, shotId: number, url: string) => {
    sbWrite(sbTokenRef.current, prev => {
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.map(s => {
        if (s.id !== shotId) return s;
        const ver = (s.videoVersions || []).find(v => v.url === url);
        return { ...s, videoUrl: url, lastFrameUrl: ver?.lastFrameUrl, status: 'completed', error: undefined };
      });
      return { ...prev, episodes: eps };
    });
  };

  // 删除某一版候选; 若删的正是当前选用版, 自动顺延到剩下的最后一版
  const removeShotVersion = (epIdx: number, shotId: number, url: string) => {
    sbWrite(sbTokenRef.current, prev => {
      const eps = [...prev.episodes];
      eps[epIdx].shots = eps[epIdx].shots.map(s => {
        if (s.id !== shotId) return s;
        const next = (s.videoVersions || []).filter(v => v.url !== url);
        if (s.videoUrl !== url) return { ...s, videoVersions: next };
        const lastVer = next[next.length - 1];
        return {
          ...s,
          videoVersions: next,
          videoUrl: lastVer?.url,
          lastFrameUrl: lastVer?.lastFrameUrl,
          status: lastVer ? 'completed' : 'pending',
          error: undefined,
        };
      });
      return { ...prev, episodes: eps };
    });
  };

  // 拖拽镜头到另一集 — 用户手动归类续集视频
  const [dragShot, setDragShot] = useState<{ epIdx: number; shotId: number } | null>(null);
  const moveShotToEpisode = (fromEpIdx: number, shotId: number, toEpIdx: number) => {
    if (fromEpIdx === toEpIdx) return;
    setStoryboard(prev => {
      if (!prev) return prev;
      const eps = [...prev.episodes];
      const shot = eps[fromEpIdx].shots.find(s => s.id === shotId);
      if (!shot) return prev;
      eps[fromEpIdx].shots = eps[fromEpIdx].shots.filter(s => s.id !== shotId);
      eps[toEpIdx].shots = [...eps[toEpIdx].shots, shot];
      return { ...prev, episodes: eps };
    });
    message.success(`镜头已移至第${toEpIdx + 1}集`);
  };

  // 提交视频任务 — 自动处理 503 video_queue_full / 429 速率限制 (最多重试 5 次)
  // 返回 provider 是必须的: 查询任务要靠它区分 agnes / agnes-video-2.5 / cogvideo /
  // seedance 四套查询接口, 前端自己猜 (曾硬编码 'agnes') 会查错引擎。
  //
  // 2026-10-13 BYOK: 本面板**自己**实现了提交与轮询, 不经过 videoTaskManager ——
  //   上一轮只给 videoTaskManager 那条路径接上了 byok, 于是分镜模式下 Key 依旧不下发,
  //   同一个自定义模型两种模式行为不一致。现在两条路径共用 resolveByokCredential。
  const submitVideoTask = async (body: any, onRetry?: (retry: number, msg: string) => void): Promise<{ taskId: string; provider?: string } | { error: string }> => {
    const byok = resolveByokCredential(model);
    // 提交时带上凭证 (body 副本, 不污染调用方持有的对象)
    const bodyWithKey = byok ? { ...body, apiKey: byok.apiKey, baseUrl: byok.baseUrl } : body;
    for (let retry = 0; retry < 5; retry++) {
      const resp = await fetch(`${httpUrl}/v1/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyWithKey) });
      const data = await resp.json();
      if (data.taskId) return { taskId: data.taskId, provider: data.provider };
      // 检测队列已满 — 503 + video_queue_full
      const errStr = String(data.error || '') + String(data.message || '') + String(data.code || '');
      const isQueueFull = resp.status === 503 || errStr.includes('video_queue_full') || errStr.includes('队列已满');
      // 检测速率限制 — 429
      const isRateLimit = resp.status === 429 || errStr.includes('429') || errStr.includes('rate_limit') || errStr.includes('速率限制');
      if (isQueueFull && retry < 4) {
        onRetry?.(retry + 1, `视频队列已满, 30s 后重试 (${retry + 1}/5)...`);
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      if (isRateLimit && retry < 4) {
        // 速率限制 — 等 60s 后重试 (Flash 免费模型限制较严)
        onRetry?.(retry + 1, `API 速率限制 (429), 60s 后重试 (${retry + 1}/5)...`);
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      return { error: data.error || data.message || `HTTP ${resp.status}` };
    }
    return { error: '重试次数用尽' };
  };

  // 收集当前镜头相关的参考图 — 角色定妆图 + 九宫格 + 场景图
  // 2026-10-13: 加 extra 参数 —— 「缺图守卫」一键补全时, 新生成的图还没进 state,
  //   直接通过 extra 并入, 避免 stale closure 导致"补了图但没带上"。
  // 2026-10-14: 加 tail 参数 —— 上一镜尾帧作为**第一张**参考图 (折中衔接模式:
  //   既保留"同人同景", 又给出"接着上一镜"的引导)。引擎上限 5 张, 尾帧优先占位。
  const collectRefImages = (epIdx: number, shot: Shot, extra?: RefExtras, tail?: string): string[] => {
    if (!storyboard) return [];
    const refs: string[] = [];
    // 0. 上一镜尾帧 (衔接用) — 放在最前
    if (tail) refs.push(tail);
    // 1. 场景图 (extra 优先 — 刚生成的)
    const ep = storyboard.episodes[epIdx];
    const sceneUrl = extra?.scenes[epIdx] || ep?.scene?.imageUrl;
    if (sceneUrl) {
      refs.push(sceneUrl);
    }
    // 2. 角色定妆图 + 九宫格 — 只传该镜头涉及的角色
    if (shot.characters && shot.characters.length > 0) {
      for (const charName of shot.characters) {
        const char = storyboard.characters.find(c => c.name === charName);
        const portraitUrl = extra?.chars[charName] || char?.portraitUrl;
        if (portraitUrl) {
          refs.push(portraitUrl);
        }
        // 九宫格也作为参考传给视频AI, 帮助它从不同角度理解角色
        if (char?.sheetUrl && refs.length < 5) {
          refs.push(char.sheetUrl);
        }
      }
    }
    // 3. 如果没有特定角色, 传所有角色定妆图 (最多5张, Agnes Flash 限制)
    if (refs.length === 0) {
      for (const char of storyboard.characters) {
        const portraitUrl = extra?.chars[char.name] || char.portraitUrl;
        if (portraitUrl) {
          refs.push(portraitUrl);
          if (refs.length >= 5) break;
        }
      }
    }
    return refs.slice(0, 5); // Agnes Flash 最多5张
  };

  // 2026-10-14: 从视频里抽尾帧 (后端 ffmpeg)。用于上一镜有视频但没带 API 尾帧时的兜底。
  //   注意: 后端 ffmpeg 缺失时该端点恒 500 (error 字段), 此处按"抽不到"处理即可。
  const extractTail = async (videoUrl: string): Promise<string | undefined> => {
    try {
      const resp = await fetch(`${httpUrl}/v1/video/extract-tail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl }),
      });
      if (!resp.ok) return undefined;
      const data = await resp.json();
      return data.tailFrameUrl || undefined;
    } catch { return undefined; }
  };

  // 上一镜**还没生成** → 弹窗问"先补上一镜 / 跳过直接生成 / 取消"
  //   (只有这一种情形弹窗: 上一镜已生成但取不到尾帧时不该弹 —— "先补上一镜" 无从谈起)
  const askPrevNotReady = (epIdx: number, prevShotId: number): Promise<{ proceed: boolean; tail?: string; skipped?: boolean }> =>
    new Promise(resolve => {
      setContinuityPrompt({
        epIdx, prevShotId,
        resolve: (v) => {
          if (v === 'cancel') return resolve({ proceed: false });
          if (v === 'skip') return resolve({ proceed: true, skipped: true });
          // fill: 先把上一镜补生成, 本镜本次不生成 (完成后用户再点本镜即可接上)
          resolve({ proceed: false });
          generateSingleShot(epIdx, prevShotId);
          message.info(`已开始生成第${prevShotId}镜, 完成后请再点本镜以接戏`);
        },
      });
    });

  // 2026-10-14: 尾帧衔接守卫 (仅在"尾帧衔接"开关打开且本镜不是集内首镜时生效)
  const guardContinuity = async (epIdx: number, shot: Shot): Promise<{ proceed: boolean; tail?: string; skipped?: boolean }> => {
    if (!continuity || !storyboard) return { proceed: true };
    const ep = storyboard.episodes[epIdx];
    if (!ep) return { proceed: true };
    const idx = ep.shots.findIndex(s => s.id === shot.id);
    const prevShot = idx > 0 ? ep.shots[idx - 1] : undefined;
    if (!prevShot) return { proceed: true }; // 集内首镜: 没有上一镜可接, 不算断链
    // ① 有 API 尾帧 → 直接用 (生成时已 return_last_frame:true)
    if (prevShot.lastFrameUrl) return { proceed: true, tail: prevShot.lastFrameUrl };
    // ② 有视频无尾帧 → 现场抽一帧 (后端 ffmpeg)
    if (prevShot.videoUrl) {
      const tail = await extractTail(prevShot.videoUrl);
      if (tail) return { proceed: true, tail };
      // 抽不到 → **静默降级**: 上一镜已生成, "先补上一镜"无从谈起; 本镜照常生成
      //   但打 ⚠ 无衔接 标。原因(服务器缺 ffmpeg)只提示一次, 避免逐镜刷屏。
      if (!tailUnavailableRef.current) {
        tailUnavailableRef.current = true;
        message.warning('取不到上一镜的尾帧 (服务器未安装 ffmpeg, 上游也未返回尾帧) — 后续镜头将只用场景图/角色图, 动作可能接不上');
      }
      return { proceed: true, skipped: true };
    }
    // ③ 上一镜根本没生成 → 询问 (可一键先补)
    return askPrevNotReady(epIdx, prevShot.id);
  };

  /** 2026-10-13: 找出某镜头缺失的参考图 (该集场景图 / 该镜角色的定妆图+九宫格) */
  const findMissingRefs = (epIdx: number, shot: Shot): { scene: boolean; chars: string[] } => {
    if (!storyboard) return { scene: false, chars: [] };
    const ep = storyboard.episodes[epIdx];
    const scene = !!ep?.scene && !ep.scene.imageUrl;
    const chars = (shot.characters || []).filter(name => {
      const c = storyboard.characters.find(x => x.name === name);
      return !!c && !c.portraitUrl && !c.sheetUrl;
    });
    return { scene, chars };
  };

  /**
   * 2026-10-13 缺图守卫: 提交视频前检查参考图是否齐备。
   * 有缺失 → 弹窗 (先补全 / 仍然生成 / 取消); 无缺失 → 直接放行。
   * @returns proceed=是否继续生成; extra=「先补全」路径新生成的图 (直接并入提交)
   */
  const guardMissingRefs = (targets: { epIdx: number; shot: Shot }[]): Promise<{ proceed: boolean; extra?: RefExtras }> => {
    if (!storyboard) return Promise.resolve({ proceed: true });
    const sceneSet = new Set<number>();
    const charSet = new Set<string>();
    for (const { epIdx, shot } of targets) {
      const m = findMissingRefs(epIdx, shot);
      if (m.scene) sceneSet.add(epIdx);
      m.chars.forEach(c => charSet.add(c));
    }
    if (sceneSet.size === 0 && charSet.size === 0) return Promise.resolve({ proceed: true });
    return new Promise(resolve => {
      setMissingPrompt({ scenes: [...sceneSet], chars: [...charSet], resolve });
    });
  };

  /** 「先补全再生成」— 生成缺失的场景图 + 角色图, 返回刚生成的 URL 供直接并入提交 */
  const completeMissingRefs = async (scenes: number[], chars: string[]): Promise<RefExtras> => {
    const extra: RefExtras = { scenes: {}, chars: {} };
    for (const epIdx of scenes) {
      const url = await generateSceneImage(epIdx);
      if (url) extra.scenes[epIdx] = url;
    }
    for (const name of chars) {
      const r = await generatePortrait(name);
      if (r?.portraitUrl) extra.chars[name] = r.portraitUrl;
    }
    return extra;
  };

  // 单镜生成 — 用户逐个点击, 适合 Flash 免费模型 (有速率限制)
  const generateSingleShot = async (epIdx: number, shotId: number) => {
    if (!storyboard) return;
    const ep = storyboard.episodes[epIdx];
    const shot = ep.shots.find(s => s.id === shotId);
    if (!shot) return;
    if (shot.status === 'generating') return;

    // ★ 剧本会话令牌: 记录发起生成时所在的剧本; 之后用户切了剧本, 所有写入作废
    const token = sbTokenRef.current;

    // 2026-10-13 缺图守卫 — 场景图/角色图缺失时先提示 (可一键补全)
    const guard = await guardMissingRefs([{ epIdx, shot }]);
    if (!guard.proceed) return;
    if (sbTokenRef.current !== token) return; // 弹窗期间切了剧本 → 放弃本次

    // 2026-10-14 尾帧衔接守卫 — 取上一镜尾帧作为本镜首个参考图; 上一镜没生成时弹窗询问
    const cont = await guardContinuity(epIdx, shot);
    if (!cont.proceed) return;
    if (sbTokenRef.current !== token) return;

    sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'generating', error: undefined, noContinuity: !!cont.skipped } : s); return { ...prev, episodes: eps }; });

    try {
      // 收集角色定妆图+场景图作为参考 (guard.extra = 刚补全的图; cont.tail = 上一镜尾帧)
      const refImages = collectRefImages(epIdx, shot, guard.extra, cont.tail);
      // 2026-10-13: prompt 走 buildSubmitPrompt — 把 dialogue/monologue 内联, 不再只发 shot.prompt;
      // 分辨率/宽高比改用面板上的选择 (原写死 720P / 16:9)。
      const body: any = { prompt: buildSubmitPrompt(shot), model, duration: `${shot.duration}s`, size: videoSize, aspect_ratio: videoAspect };
      // 有参考图时用 reference 模式
      if (refImages.length > 0) {
        body.images = refImages;
      }
      const result = await submitVideoTask(body, (retry, msg) => {
        sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'generating', error: msg } : s); return { ...prev, episodes: eps }; });
      });
      if ('error' in result) {
        sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: result.error } : s); return { ...prev, episodes: eps }; });
        return;
      }
      const videoResult = await pollVideo(result.taskId, result.provider || model);
      if (videoResult) {
        // ★ 2026-10-14: 追加候选版本 — 重新生成不再覆盖旧版, 每次结果都归到 (当前剧本的) 本镜下
        sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? withNewVersion(s, videoResult) : s); return { ...prev, episodes: eps }; });
        if (sbTokenRef.current === token) {
          // 之前已有版本 → 这是"再生成", 提示用户去右侧对比选用 (计数交给预览面板展示)
          const hadVersion = !!storyboard.episodes[epIdx]?.shots.find(s => s.id === shotId)?.videoUrl;
          message.success(`第${epIdx + 1}集-${shotId}镜 生成完成${hadVersion ? ' (新增一版候选, 可在右侧预览对比选用)' : ''}`);
        }
      } else {
        sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: '轮询超时或任务失败' } : s); return { ...prev, episodes: eps }; });
      }
    } catch (e: any) {
      sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: e.message } : s); return { ...prev, episodes: eps }; });
    }
  };

  // 批量生成 — 支持所有模型, Flash 模型自动延迟避免速率限制
  const isFlashModel = model === 'agnes' || model.includes('flash');
  const batchGenerate = async () => {
    if (!storyboard) return;
    const allShots = storyboard.episodes.flatMap(ep => ep.shots.filter(s => s.selected && s.status !== 'completed'));
    if (allShots.length === 0) { message.warning('没有需要生成的镜头'); return; }

    // 2026-10-13 缺图守卫 — 汇总所有待生成镜头缺失的场景/角色图, 只弹一次窗
    const targets: { epIdx: number; shot: Shot }[] = [];
    storyboard.episodes.forEach((ep, epIdx) => {
      ep.shots.forEach(s => { if (s.selected && s.status !== 'completed') targets.push({ epIdx, shot: s }); });
    });
    const guard = await guardMissingRefs(targets);
    if (!guard.proceed) return;
    const token = sbTokenRef.current; // ★ 剧本会话令牌: 换剧本后所有写入作废 + 循环中止
    if (sbTokenRef.current !== token) return;

    // Flash 模型警告
    if (isFlashModel && allShots.length > 3) {
      message.warning(`Flash 免费模型有速率限制, ${allShots.length} 镜将逐个生成 (每镜间隔 10s), 预计耗时较长`);
    }
    setBatchGenerating(true);
    setBatchProgress(0);
    setBatchCancelled(false);
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    // 2026-10-14 尾帧衔接: 批量里逐镜推进, 用本地表记录"刚生成的尾帧",
    //   供下一镜作首个参考图 —— 保证同一次批量内镜与镜能接上 (不依赖 state 刷新)。
    const tailByShot = new Map<number, string | undefined>();

    for (let epIdx = 0; epIdx < storyboard.episodes.length; epIdx++) {
      const ep = storyboard.episodes[epIdx];
      for (const shot of ep.shots) {
        if (!shot.selected || shot.status === 'completed') continue;
        // 2026-10-12: 取消检查点 — 每镜开跑前看一眼, 已取消则收尾退出
        if (batchCancelled) break;
        // ★ 2026-10-14: 用户切换剧本 → 立即中止, 不再继续烧额度
        if (sbTokenRef.current !== token) break;

        // 2026-10-14: 上一镜尾帧 (批量内优先用刚生成的, 其次用已存的) — 不弹窗, 拿不到就无衔接并打标
        let tail: string | undefined;
        let noCont = false;
        if (continuity) {
          const shotIdx = ep.shots.findIndex(s => s.id === shot.id);
          const prevShot = shotIdx > 0 ? ep.shots[shotIdx - 1] : undefined;
          if (prevShot) {
            tail = tailByShot.get(prevShot.id) ?? prevShot.lastFrameUrl;
            if (!tail) noCont = true;
          }
        }

        sbWrite(token, prev => {
          const eps = [...prev.episodes];
          eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'generating', noContinuity: noCont } : s);
          return { ...prev, episodes: eps };
        });

          try {
            // 收集角色定妆图+场景图作为参考 (guard.extra = 刚补全的图; tail = 上一镜尾帧)
            const refImages = collectRefImages(epIdx, shot, guard.extra, tail);
            // 2026-10-13: 对白/独白内联 + 面板分辨率/宽高比 (原写死 720P/16:9)
            const body: any = { prompt: buildSubmitPrompt(shot), model, duration: `${shot.duration}s`, size: videoSize, aspect_ratio: videoAspect };
            if (refImages.length > 0) {
              body.images = refImages;
            }
            const result = await submitVideoTask(body, (retry, msg) => {
              sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'generating', error: msg } : s); return { ...prev, episodes: eps }; });
            });
            if ('error' in result) {
              failed++;
              sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: result.error } : s); return { ...prev, episodes: eps }; });
            } else {
              const videoResult = await pollVideo(result.taskId, result.provider || model);
              if (videoResult) {
                succeeded++;
                tailByShot.set(shot.id, videoResult.lastFrameUrl); // 2026-10-14: 供下一镜接戏
                // ★ 2026-10-14: 同样追加候选版本 (与单镜一致, 重新生成不丢旧版)
                sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? withNewVersion(s, videoResult) : s); return { ...prev, episodes: eps }; });
              } else {
                failed++;
                sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: '轮询超时或任务失败' } : s); return { ...prev, episodes: eps }; });
              }
            }
          } catch (e: any) {
          failed++;
          sbWrite(token, prev => { const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: e.message } : s); return { ...prev, episodes: eps }; });
        }
        completed++;
        setBatchProgress(Math.round((completed / allShots.length) * 100));
        // Flash 模型: 每镜之间延迟 10s, 避免触发速率限制
        if (isFlashModel && completed < allShots.length) {
          await new Promise(r => setTimeout(r, 10000));
        }
      }
    }
    setBatchGenerating(false);
    const switched = sbTokenRef.current !== token;
    const failMsg = failed > 0 ? `, ${failed} 镜失败` : '';
    const cancelMsg = batchCancelled ? ` (已取消, 剩 ${allShots.length - completed} 镜未跑)` : '';
    // 剧本已切换时不再报「完成」——那些镜头不属于当前剧本
    if (!switched) message.info(`批量生成${batchCancelled ? '已取消' : '完成'}: ${succeeded} 镜成功${failMsg}${cancelMsg}`, 5);
  };

  const pollVideo = (taskId: string, provider: string): Promise<{ videoUrl: string; lastFrameUrl?: string } | null> => {
    // 2026-10-13 BYOK: 自定义模型的任务查询也必须带同一份凭证, 否则提交成功却永远查不到结果。
    // Key 走请求头而非 query (会进浏览器历史/访问日志)。与 videoTaskManager 一致。
    const byok = resolveByokCredential(model);
    const pollHeaders: Record<string, string> = {};
    if (byok?.apiKey) {
      pollHeaders['X-Video-Api-Key'] = byok.apiKey;
      if (byok.baseUrl) pollHeaders['X-Video-Base-Url'] = byok.baseUrl;
    }
    return new Promise((resolve) => {
      let attempts = 0;
      let consecutiveErrors = 0;
      // 5s × 180 = 15 分钟。原先 60 次 (5 分钟) 对 1080P 正式版常常不够,
      // 任务其实还在跑就被判"超时"。
      const interval = setInterval(async () => {
        if (++attempts > 180) { clearInterval(interval); resolve(null); return; }
        try {
          // ⚠️ 这里曾经打 /v1/video/query?taskId=..&model=.. —— 该端点从未存在。
          //    请求会被 GET /v1/video/:taskId 以 taskId='query' 吃掉, 且后端读的是
          //    req.query.provider 而不是 model, 于是恒返 400「无法识别 provider: (空)」,
          //    每一镜都在 3 次失败 (15s) 后变成「轮询超时或任务失败」——视频其实
          //    在上游生成成功了, 只是 URL 永远拿不回来。
          const queryUrl = `${httpUrl}/v1/video/${encodeURIComponent(taskId)}?provider=${encodeURIComponent(provider)}`;
          const resp = await fetch(queryUrl, { headers: pollHeaders });
          if (!resp.ok) {
            if (++consecutiveErrors >= 3) { clearInterval(interval); resolve(null); return; }
            return;
          }
          consecutiveErrors = 0;
          const data = await resp.json();
          if (data.error) { clearInterval(interval); resolve(null); return; }
          if (data.status === 'completed' || data.status === 'success') {
            clearInterval(interval);
            resolve({ videoUrl: data.videoUrl, lastFrameUrl: data.lastFrameUrl });
          }
          else if (data.status === 'failed' || data.status === 'error') { clearInterval(interval); resolve(null); return; }
        } catch {
          if (++consecutiveErrors >= 3) { clearInterval(interval); resolve(null); return; }
        }
      }, 5000);
    });
  };

  const totalShots = storyboard?.episodes.flatMap(e => e.shots).length || 0;
  const completedShots = storyboard?.episodes.flatMap(e => e.shots).filter(s => s.status === 'completed').length || 0;
  const selectedShots = storyboard?.episodes.flatMap(e => e.shots).filter(s => s.selected && s.status !== 'completed').length || 0;

// 2026-10-14 修复"底部被裁": 根容器原为 height:'100%' —— 但在 VideoGen 的 flex 列里,
// 上方还有"生成模型"选择行, height:100% 会等于父容器整高 → 多出选择行的高度被 overflow:hidden 裁掉。
// 改成 flex:1 + minHeight:0, 只在列中占"剩余"空间 (与 .page-body 的 min-height:0 同一套契约)。
return (
<div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
<style>{RIGHT_COLLAPSE_CSS}</style>
      {/* 左侧: 输入 + 角色卡 + 分镜列表 — 右侧折叠时自动扩展到 100% (批次9 修) */}
      {/* 2026-10-12 C 批次: 宽度改由 useResizable 管 (可拖拽/双击复位/方向键/记忆/窄屏兜底)
          side:'right' → 把手在左栏右缘, 即两栏交界处
          ✅ 批次9: 右栏折叠 (rightPanelExpanded 空) 时左栏 flex:1 撑满剩余空间,
          否则 620px 固定 + 右栏 display:none = 右边一大块黑 (用户报的"布局有问题")
          ⚠️ 2026-10-14 结构修复: 原左栏把 overflow:auto 写在外层 (.page-pane 本身) ——
            而 .pane-grip 是 position:absolute, 放进滚动容器会随内容滚走 → 把手顶部即消失,
            用户"拖不动/拖不到把手扩大左栏"。现拆两层: 外层(不滚, 承载把手) + 内层滚动容器。 */}
      <div ref={sbLeftPane.paneRef} className="page-pane page-pane--left"
        style={rightPanelExpanded.length === 0
          ? { flex: 1, minWidth: 0, width: 'auto' }   // 折叠: 左栏撑满
          : { width: sbLeftPane.width, flexShrink: 0 }}>
        <PaneGrip resizable={sbLeftPane} min={380} max={900} label="调整剧本编辑区宽度" />
        {/* 内层滚动容器: 外层 .page-pane 不滚动 (overflow:hidden) → 把手不会被内容滚走。
            内层承担原有滚动/布局 (flex 列 + gap + paddingRight)。 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {/* 输入区 */}
        <Card size="small" title={
          <Space>
            <VideoCameraOutlined /> 剧本分镜
            {storyboardList.length > 0 && (
              <Select size="small" style={{ width: 180 }} value={activeId || undefined} placeholder="选择剧本"
                onChange={(v) => v && switchStoryboard(v)}
                options={storyboardList.map(s => ({ value: s.id, label: `${s.title} (${new Date(s.updatedAt).toLocaleDateString()})` }))}
              />
            )}
          </Space>
        }
          extra={
            <Space size={4}>
              {storyboard && <Tag color="blue">{totalShots}镜</Tag>}
              {storyboard && <Tag color="green">{completedShots}完成</Tag>}
              {storyboard && <Tag color="orange">{selectedShots}待生成</Tag>}
              {/* ★ 2026-10-12 P0 修复: 右栏原本没有任何展开入口 ——
                  setRightPanelExpanded 只有 Collapse 自己的 onChange 一处,
                  而 Collapse 位于 display:none 的右栏内部 → 用户永远打不开
                  「分镜预览/剧集成品」。这里补两个显式开关, 默认展开预览。 */}
              {storyboard && (
                <>
                  <Tooltip title="分镜预览（右侧）">
                    <Button size="small" type={rightPanelExpanded.includes('preview') ? 'primary' : 'default'}
                      icon={<EyeOutlined />}
                      onClick={() => setRightPanelExpanded(prev =>
                        prev.includes('preview') ? prev.filter(k => k !== 'preview') : [...prev, 'preview']
                      )} />
                  </Tooltip>
                  <Tooltip title="剧集成品与导出（右侧）">
                    <Button size="small" type={rightPanelExpanded.includes('export') ? 'primary' : 'default'}
                      icon={<ExportOutlined />}
                      onClick={() => setRightPanelExpanded(prev =>
                        prev.includes('export') ? prev.filter(k => k !== 'export') : [...prev, 'export']
                      )} />
                  </Tooltip>
                </>
              )}
              <Tooltip title="新建剧本 (当前剧本已自动保存)">
                <Button size="small" icon={<PlusOutlined />} onClick={newStoryboard} />
              </Tooltip>
              {storyboard && activeId && (
                <Tooltip title="删除当前剧本">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                    Modal.confirm({
                      title: '删除剧本',
                      content: `确定删除「${storyboard.title}」? 此操作不可恢复。`,
                      okText: '删除', okType: 'danger', cancelText: '取消',
                      onOk: () => deleteStoryboard(activeId),
                    });
                  }} />
                </Tooltip>
              )}
            </Space>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <TextArea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="描述你的创意, 例: 一个建筑从地基到完工的生长动画, 5集"
              autoSize={{ minRows: 2, maxRows: 6 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>集数:</span>
              <InputNumber min={1} max={20} value={episodeCount} onChange={v => setEpisodeCount(v || 1)} size="small" style={{ width: 60 }} />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>单镜时长:</span>
              <Select size="small" value={shotDuration} onChange={v => setShotDuration(v)} style={{ width: 80 }}
                options={[{ value: 4, label: '4s' }, { value: 5, label: '5s' }, { value: 8, label: '8s' }, { value: 10, label: '10s' }]} />
              {/* 2026-10-13: 视频生成参数 — 与单次生成页对齐 (原写死 720P / 16:9) */}
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>分辨率:</span>
              <Select size="small" value={videoSize} onChange={v => setVideoSize(v)} style={{ width: 90 }}
                options={[{ value: '720P', label: '720P' }, { value: '1080P', label: '1080P' }]} />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>宽高比:</span>
              <Select size="small" value={videoAspect} onChange={v => setVideoAspect(v)} style={{ width: 90 }}
                options={[{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }]} />
              {/* 2026-10-14: 尾帧衔接开关 — 上一镜尾帧作本镜首个参考图, 让镜头接上戏 */}
              <Tooltip title="把上一镜的尾帧作为本镜的第一个参考图, 让镜头能接着上一镜 (换场/换景/蒙太奇时可关)">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                  尾帧衔接 <Switch size="small" checked={continuity} onChange={setContinuity} />
                </span>
              </Tooltip>
              <div style={{ flex: 1 }} />
              <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={generateStoryboard}>
                {generating ? '生成中...' : '生成剧本'}
              </Button>
            </div>
            {refImages.length > 0 && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}><PictureOutlined /> 已上传 {refImages.length} 张参考图</div>}
            {scriptProvider && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>剧本模型: {activeModelId} (跟随对话所选)</div>}
          </div>
        </Card>

{/* 角色卡区域 — 独立面板 */}
{storyboard?.characters && storyboard.characters.length > 0 && (
<Card size="small" title={<Space><UserOutlined /> 角色卡 ({storyboard.characters.length})</Space>}
  extra={
    <Select
      size="small"
      placeholder="从角色库导入"
      style={{ width: 150 }}
      showSearch
      optionFilterProp="label"
      options={loadCharLibrary().map(c => ({ value: c.name, label: c.name }))}
      onChange={(name) => {
        const libChar = loadCharLibrary().find(c => c.name === name);
        if (!libChar) return;
        setStoryboard(prev => {
          if (!prev) return prev;
          // 如果角色已存在则更新, 否则添加
          const exists = prev.characters.find(c => c.name === name);
          if (exists) {
            return { ...prev, characters: prev.characters.map(c => c.name === name ? { ...c, portraitUrl: libChar.portraitUrl, sheetUrl: libChar.sheetUrl } : c) };
          }
          return { ...prev, characters: [...prev.characters, { name: libChar.name, description: libChar.description, portraitUrl: libChar.portraitUrl, sheetUrl: libChar.sheetUrl }] };
        });
        message.success(`已从角色库导入: ${name}`);
      }}
    />
  }
>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {storyboard.characters.map((char, i) => (
                <div key={i} style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                  {/* 定妆图 — 点击查看大图 */}
                  <div style={{ width: '100%', height: 140, borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: char.portraitUrl ? 'zoom-in' : 'default', position: 'relative' }}
                    onClick={() => char.portraitUrl && setZoomPortrait({ url: char.portraitUrl, name: char.name })}>
                    {char.portraitUrl ? (
                      <img src={char.portraitUrl} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : generatingPortrait === char.name ? (
                      <Spin tip="生成中..." />
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                        <UserOutlined style={{ fontSize: 32 }} />
                        <div style={{ fontSize: 'var(--fs-micro)', marginTop: 4 }}>暂无定妆图</div>
                      </div>
                    )}
                    {char.portraitUrl && (
                      <div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: 'var(--fg-on-accent)', fontSize: 'var(--fs-micro)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>🔍 点击放大</div>
                    )}
                  </div>
                  {/* 角色信息 */}
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 2 }}>{char.name}</div>
                  <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 6, lineHeight: 1.4 }}>{char.description}</div>
                  {char.refImageIndex !== undefined && refImages[char.refImageIndex] && (
                    <Tag color="blue" style={{ fontSize: 'var(--fs-micro)', marginBottom: 4 }}>参考图 {char.refImageIndex + 1}</Tag>
                  )}
                  {/* 九宫格缩略图 — 点击查看大图 */}
                  {char.sheetUrl && (
                    <div style={{ marginBottom: 6, cursor: 'zoom-in' }}
                      onClick={() => setZoomPortrait({ url: char.sheetUrl!, name: `${char.name} — 九宫格参考` })}>
                      <img src={char.sheetUrl} alt={`${char.name} 九宫格`} style={{ width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>📋 九宫格参考 (点击放大)</div>
                    </div>
                  )}
                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button size="small" type="primary" ghost icon={<CameraOutlined />} loading={generatingPortrait === char.name}
                      onClick={() => generatePortrait(char.name)} style={{ fontSize: 'var(--fs-micro)', flex: 1 }}>生成角色图</Button>
                    <Upload showUploadList={false} beforeUpload={(file) => { uploadPortrait(char.name, file); return false; }}>
                      <Button size="small" icon={<PictureOutlined />} style={{ fontSize: 'var(--fs-micro)' }}>上传</Button>
                    </Upload>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 批量生成进度 — 2026-10-12 补「取消」: 原来循环无 cancel flag,
            10 镜串行一旦开始只能等完或刷新页面 */}
        {batchGenerating && (
          <Card size="small">
            <Progress percent={batchProgress} status="active" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              <span>批量生成中... {batchProgress}%</span>
              <Button size="small" danger onClick={() => { setBatchCancelled(true); message.info('已取消, 正在收尾当前镜头...'); }}>
                取消批量
              </Button>
            </div>
          </Card>
        )}

        {/* 批量生成按钮 — 仅商业模型显示, Flash 免费模型由用户逐镜生成 */}
        {storyboard && selectedShots > 0 && !batchGenerating && !isFlashModel && (
          <Button type="primary" size="large" icon={<VideoCameraOutlined />} onClick={batchGenerate}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 'var(--radius-md)' }}>
            批量生成 ({selectedShots} 镜)
          </Button>
        )}

        {/* 2026-10-12 B-4: 失败重试入口 — 原来批量跑完有失败镜头只能
            一集一集展开、一个一个点「重试」。这里汇总成一键重跑。 */}
        {storyboard && !batchGenerating && (() => {
          const failed = storyboard.episodes.flatMap((ep, epIdx) =>
            ep.shots.filter(s => s.status === 'failed').map(s => ({ epIdx, shotId: s.id })));
          if (failed.length === 0) return null;
          return (
            <Alert type="warning" showIcon
              message={`${failed.length} 个镜头生成失败`}
              description="失败通常是限流或超时。可一键重试所有失败镜头 (串行执行)。"
              action={
                <Button size="small" danger icon={<ReloadOutlined />} onClick={() => retryFailedShots()}>
                  重试失败项
                </Button>
              }
            />
          );
        })()}
        {storyboard && isFlashModel && (
          <Alert type="info" showIcon style={{ fontSize: 'var(--fs-micro)' }}
            message="当前为 Flash 免费模型, 有速率限制"
            description="请逐镜点击「生成」按钮, 一个一个生成。切换到商业模型可批量生成。" />
        )}

        {/* 分集列表 — 2026-10-12 布局简化: 默认只展开第一集。
            原为全部展开 (episodes.map), 10 集剧本一屏放不下, 用户要先滚很久
            才能看到别的 —— 信息过载是"不简洁明了"的主因。 */}
        {storyboard && (
          <Collapse defaultActiveKey={storyboard.episodes.length > 0 ? [String(storyboard.episodes[0].index)] : []}>
            {storyboard.episodes.map((ep, epIdx) => (
              <Panel key={ep.index} header={
                <Space>
                  <strong>第 {ep.index} 集</strong>
                  <span style={{ color: 'var(--muted)' }}>{ep.title}</span>
                  <Tag>{ep.shots.length} 镜</Tag>
                  <Tag color="green">{ep.shots.filter(s => s.status === 'completed').length} 完成</Tag>
                  {ep.scene && <Tag color="cyan">场景: {ep.scene.name}</Tag>}
                  {epIdx === storyboard.episodes.length - 1 && (
                    <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />}
                      loading={generatingSequel === epIdx}
                      onClick={(e) => { e.stopPropagation(); generateSequel(epIdx); }}
                      style={{ fontSize: 'var(--fs-micro)' }}>
                      智能续集
                    </Button>
                  )}
                </Space>
              }>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* 场景卡 — 每集固定场景, 保证跨集一致 */}
                  {ep.scene && (
                    <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 4 }}>
                      <div style={{ width: 160, height: 90, borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0, background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: ep.scene.imageUrl ? 'zoom-in' : 'default', position: 'relative' }}
                        onClick={() => ep.scene?.imageUrl && setZoomScene({ url: ep.scene.imageUrl, name: `第${ep.index}集 场景: ${ep.scene.name}` })}>
                        {ep.scene.imageUrl ? (
                          <img src={ep.scene.imageUrl} alt={ep.scene.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : generatingScene === epIdx ? (
                          <Spin size="small" />
                        ) : (
                          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}><PictureOutlined style={{ fontSize: 'var(--fs-xl)' }} /><br />暂无场景图</div>
                        )}
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 2 }}>🎬 {ep.scene.name}</div>
                        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: 1.4, marginBottom: 4 }}>{ep.scene.description}</div>
                        <Button size="small" type="primary" ghost icon={<CameraOutlined />} loading={generatingScene === epIdx}
                          onClick={() => generateSceneImage(epIdx)} style={{ fontSize: 'var(--fs-micro)', width: 'fit-content' }}>
                          {ep.scene.imageUrl ? '重新生成场景' : '生成场景图'}
                        </Button>
                        {ep.scene.imageUrl && (
                          <Button size="small" type="primary" icon={<EditOutlined />}
                            onClick={() => setEditingScene(epIdx)} style={{ fontSize: 'var(--fs-micro)', marginLeft: 4 }}>
                            精编
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {ep.shots.map((shot, shotIdx) => (
                    <div key={shot.id} style={{
                      padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)',
                      // 2026-10-12 布局简化: 左侧 3px 状态色条替代"边框变色 + Tag + Spin"三重表达。
                      // 原设计把 completed→绿Tag / failed→红Tag / generating→Spin 全挤在头部,
                      // 同一个状态有三处视觉重复。现在状态只由色条 + 按钮文字两处承担。
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${shot.status === 'completed' ? 'var(--success)' : shot.status === 'failed' ? 'var(--danger)' : shot.status === 'generating' ? 'var(--warning)' : 'var(--border)'}`,
                    }}>
                        {/* 头部一行: 镜号 · 类型 · 时长 · 状态 · 操作 — 元信息下沉第二行 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Checkbox checked={shot.selected} onChange={() => toggleShot(epIdx, shot.id)} />
                          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, flexShrink: 0 }}>镜 {shotIdx + 1}</span>
                          <Tag style={{ fontSize: 'var(--fs-micro)' }}>{shot.type}</Tag>
                          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', flexShrink: 0 }}>{shot.duration}s</span>
                          <div style={{ flex: 1 }} />
                          {shot.status === 'generating' && <Spin size="small" />}
                          {/* 2026-10-14: 已生成不再是终点 — 解禁按钮支持"重新生成", 结果作为新候选版本累加 */}
                          <Button size="small" type={shot.status === 'completed' ? 'default' : 'primary'}
                            loading={shot.status === 'generating'} disabled={shot.status === 'generating'}
                            onClick={() => generateSingleShot(epIdx, shot.id)} style={{ fontSize: 'var(--fs-micro)', padding: '0 6px' }}>
                            {shot.status === 'generating' ? '生成中' : shot.status === 'failed' ? '重试' : shot.status === 'completed' ? '重新生成' : '生成'}
                          </Button>
                          {(shot.videoVersions?.length || 0) > 1 && (
                            <Tag color="blue" style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>
                              {shot.videoVersions!.length} 版
                            </Tag>
                          )}
                          {/* 2026-10-14: 未接上上一镜尾帧的提示 (本段独立生成, 可能接不上戏) */}
                          {shot.noContinuity && (
                            <Tooltip title="本镜生成时没有接上上一镜的尾帧 (上一镜未生成或尾帧提取失败) — 与上一镜可能接不上戏">
                              <Tag color="warning" style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>⚠ 无衔接</Tag>
                            </Tooltip>
                          )}
                          <Tooltip title="删除"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteShot(epIdx, shot.id)} /></Tooltip>
                        </div>
                        {/* 第二行: 元信息 — 运镜/氛围/角色, 次要信息不再抢首行焦点 */}
                        {(shot.camera_motion || shot.mood || (shot.characters && shot.characters.length > 0)) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4, fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>
                            {shot.camera_motion && <span>{shot.camera_motion}</span>}
                            {shot.camera_motion && shot.mood && <span>·</span>}
                            {shot.mood && <span>{shot.mood}</span>}
                            {shot.characters?.map((c, i) => <Tag key={i} color="purple" style={{ fontSize: 'var(--fs-micro)' }}>{c}</Tag>)}
                          </div>
                        )}
                        <TextArea value={shot.prompt} onChange={e => updateShotPrompt(epIdx, shot.id, e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 'var(--fs-sm)' }} disabled={shot.status === 'generating'} />
                        {/* 2026-10-13: 台词/独白改为可编辑 — 提交时会内联进视频 prompt 做音画同步,
                            用户看到 AI 生成的对白后可直接微调再生成。 */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 4 }}>
                          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: '22px', flexShrink: 0 }}>💬 台词</span>
                          <TextArea value={shot.dialogue || ''} onChange={e => updateShotField(epIdx, shot.id, 'dialogue', e.target.value)}
                            placeholder='角色说出口的台词 (将驱动音画同步)'
                            autoSize={{ minRows: 1, maxRows: 3 }} style={{ fontSize: 'var(--fs-sm)' }} disabled={shot.status === 'generating'} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginTop: 4 }}>
                          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', lineHeight: '22px', flexShrink: 0 }}>💭 独白</span>
                          <TextArea value={shot.monologue || ''} onChange={e => updateShotField(epIdx, shot.id, 'monologue', e.target.value)}
                            placeholder='内心独白/旁白 (可空)'
                            autoSize={{ minRows: 1, maxRows: 3 }} style={{ fontSize: 'var(--fs-sm)' }} disabled={shot.status === 'generating'} />
                        </div>
                        {shot.error && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--danger)', marginTop: 4 }}>{shot.error}</div>}
                      </div>
                  ))}
                </div>
              </Panel>
            ))}
          </Collapse>
        )}
        </div>
      </div>

{/* 右侧: 可折叠 — 分镜预览 + 剧集成品, 折叠时完全隐藏让左侧全宽 */}
<div style={{ flex: 1, display: rightPanelExpanded.length > 0 ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        {storyboard ? (
          <Collapse
            activeKey={rightPanelExpanded}
            onChange={(keys) => setRightPanelExpanded(keys as string[])}
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            className="storyboard-right-collapse"
          >
            {/* ===== 分镜预览面板 ===== */}
            <Panel
              key="preview"
              header={
                <Space>
                  <VideoCameraOutlined />
                  <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>分镜预览</span>
                  <Tag style={{ fontSize: 'var(--fs-micro)' }}>
                    {/* 2026-10-14: 计"视频总数" = 各镜候选版本数之和 (含历史版), 旧数据无 versions 时按单版算 */}
                    {storyboard.episodes.reduce((sum, ep) => sum + ep.shots.reduce((a, s) => a + (s.videoVersions?.length || (s.videoUrl ? 1 : 0)), 0), 0)} 个视频
                  </Tag>
                </Space>
              }
              style={{ flex: rightPanelExpanded.includes('preview') ? 1 : 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <div style={{ overflow: 'auto', paddingRight: 4, flex: 1 }}>
                {storyboard.episodes.map(ep => (
                  <div key={ep.index} style={{ marginBottom: 8 }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragShot) { moveShotToEpisode(dragShot.epIdx, dragShot.shotId, ep.index - 1); setDragShot(null); }
                    }}>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, margin: '8px 0 4px', color: 'var(--fg-2)' }}>第 {ep.index} 集 · {ep.title}</div>
                    {ep.shots.filter(s => s.videoUrl).length === 0 ? (
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', padding: 4 }}>暂无已生成的视频 · 可从其他集拖拽镜头到此</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                        {ep.shots.filter(s => s.videoUrl).map(shot => (
                          <div key={shot.id} style={{ position: 'relative' }}
                            draggable
                            onDragStart={() => setDragShot({ epIdx: ep.index - 1, shotId: shot.id })}
                            onDragEnd={() => setDragShot(null)}>
                            <video src={shot.videoUrl} controls style={{ width: '100%', borderRadius: 'var(--radius-md)', background: '#000' }} />
                            <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: 'var(--fg-on-accent)', fontSize: 'var(--fs-micro)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                              {ep.index}-{shot.id} · {shot.type}
                            </div>
                            {/* 2026-10-14: 多版本候选 — 每版都是本镜在本剧集下的生成结果, 可对比/选用/删除 */}
                            {(shot.videoVersions?.length || 0) > 1 && (
                              <Popover
                                trigger="click"
                                placement="bottomRight"
                                title={`镜 ${shot.id} · 当前 ${shot.videoVersions!.findIndex(v => v.url === shot.videoUrl) + 1}/${shot.videoVersions!.length} 版`}
                                content={
                                  <div style={{ width: 320, maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {shot.videoVersions!.map((ver, vi) => {
                                      const isCur = ver.url === shot.videoUrl;
                                      return (
                                        <div key={ver.url} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 4, borderRadius: 'var(--radius-sm)', background: isCur ? 'var(--accent-soft)' : 'transparent', border: `1px solid ${isCur ? 'var(--accent)' : 'var(--border)'}` }}>
                                          <video src={ver.url} muted preload="metadata" style={{ width: 96, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: '#000', flexShrink: 0 }} />
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: isCur ? 700 : 400 }}>
                                              第 {vi + 1} 版 {isCur && <Tag color="green" style={{ fontSize: 'var(--fs-micro)', margin: 0 }}>当前</Tag>}
                                            </div>
                                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                                              {new Date(ver.createdAt).toLocaleString()}{ver.model ? ` · ${ver.model}` : ''}
                                            </div>
                                          </div>
                                          {!isCur && <Button size="small" type="primary" style={{ fontSize: 'var(--fs-micro)' }} onClick={() => selectShotVersion(ep.index - 1, shot.id, ver.url)}>选用</Button>}
                                          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeShotVersion(ep.index - 1, shot.id, ver.url)} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                }>
                                <Button size="small" style={{ position: 'absolute', top: 4, right: 4, fontSize: 'var(--fs-micro)', padding: '0 6px' }}>
                                  {shot.videoVersions!.length} 版
                                </Button>
                              </Popover>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            {/* ===== 剧集成品面板 ===== */}
            <Panel
              key="export"
              header={
                <Space>
                  <FileOutlined />
                  <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>剧集成品 · 拼接导出</span>
                  <Tag style={{ fontSize: 'var(--fs-micro)' }} color="green">
                    {storyboard.episodes.filter(ep => ep.shots.length > 0 && ep.shots.every(s => s.videoUrl)).length}/{storyboard.episodes.length} 集完成
                  </Tag>
                </Space>
              }
              style={{ flexShrink: 0 }}
            >
              <div style={{ overflow: 'auto', maxHeight: '300px' }}>
                {storyboard.episodes.map(ep => {
                  const completedShots = ep.shots.filter(s => s.videoUrl);
                  const totalShots = ep.shots.length;
                  const isComplete = completedShots.length === totalShots && totalShots > 0;
                  return (
                    <div key={ep.index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)', marginBottom: 4 }}>
                      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: isComplete ? 'var(--success)' : 'var(--bg)', color: isComplete ? '#fff' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                        {ep.index}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                        <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>{completedShots.length}/{totalShots} 镜已完成</div>
                      </div>
                      {isComplete ? (
                        <Button size="small" type="primary" icon={<VideoCameraOutlined />}
                          loading={merging === ep.index}
                          onClick={async () => {
                            const urls = completedShots.map(s => s.videoUrl).filter(Boolean) as string[];
                            if (urls.length === 0) return;
                            if (urls.length === 1) {
                              window.open(urls[0], '_blank');
                              return;
                            }
                            setMerging(ep.index);
                            try {
                              const resp = await fetch(`${httpUrl}/v1/video/concat`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ videoUrls: urls, title: ep.title }),
                              });
                              const data = await resp.json();
                              if (data.error) { message.error(`拼接失败: ${data.error}`); return; }
                              const mergedUrl = data.url?.startsWith('/') ? httpUrl + data.url : data.url;
                              message.success(`✅ 第${ep.index}集拼接完成 (${data.segments || urls.length}段)`);
                              window.open(mergedUrl, '_blank');
                            } catch (e: any) { message.error('拼接失败: ' + e.message); }
                            finally { setMerging(null); }
                          }}
                          style={{ fontSize: 'var(--fs-micro)' }}>
                          拼接播放
                        </Button>
                      ) : (
                        <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 3px' }} color="orange">未完成</Tag>
                      )}
                    </div>
                  );
                })}
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 6, textAlign: 'center' }}>
                  所有镜头生成完毕后, 点击「拼接播放」自动合并为完整剧集视频 (需后端 ffmpeg 支持)。
                </div>
              </div>
            </Panel>
          </Collapse>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--muted)' }}>
            <VideoCameraOutlined style={{ fontSize: 40, marginBottom: 12 }} />
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>剧本分镜</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted-2)', marginTop: 4 }}>输入创意 → 生成剧本 → 编辑分镜 → 逐镜生成</div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8 }}>右侧可折叠: 分镜预览 · 剧集成品拼接</div>
          </div>
        )}
       </div>

      {/* 角色九宫格大图查看 Modal */}
      <Modal open={!!zoomPortrait} title={zoomPortrait?.name ? `${zoomPortrait.name} — 定妆图` : '角色图'}
        footer={null} width="90%" style={{ top: 20 }}
        onCancel={() => setZoomPortrait(null)}>
        {zoomPortrait && (
          <img src={zoomPortrait.url} alt={zoomPortrait.name} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
        )}
      </Modal>

      {/* 场景图大图查看 Modal */}
      <Modal open={!!zoomScene} title={zoomScene?.name || '场景图'}
        footer={null} width="90%" style={{ top: 20 }}
        onCancel={() => setZoomScene(null)}>
        {zoomScene && (
          <img src={zoomScene.url} alt={zoomScene.name} style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
        )}
      </Modal>

      {/* 2026-10-13 缺图守卫 Modal — 未生成场景/角色图就生成视频时拦截 */}
      <Modal
        open={!!missingPrompt}
        title="⚠️ 缺少场景 / 角色参考图"
        maskClosable={false}
        closable={false}
        footer={[
          <Button key="cancel" onClick={() => { missingPrompt?.resolve({ proceed: false }); setMissingPrompt(null); }}>
            取消
          </Button>,
          <Button key="skip" onClick={() => { missingPrompt?.resolve({ proceed: true }); setMissingPrompt(null); }}>
            仍然生成
          </Button>,
          <Button key="complete" type="primary" loading={completingRefs}
            onClick={async () => {
              if (!missingPrompt) return;
              setCompletingRefs(true);
              try {
                const extra = await completeMissingRefs(missingPrompt.scenes, missingPrompt.chars);
                missingPrompt.resolve({ proceed: true, extra });
              } finally {
                setCompletingRefs(false);
                setMissingPrompt(null);
              }
            }}>
            先补全再生成
          </Button>,
        ]}
      >
        <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7 }}>
          直接生成会缺少一致性参考图，可能导致角色/场景与设定不符 (白生成)。建议先补齐：
          {missingPrompt && missingPrompt.scenes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              🎬 <b>缺场景图</b>: {missingPrompt.scenes.map(i => `第${i + 1}集`).join('、')}
            </div>
          )}
          {missingPrompt && missingPrompt.chars.length > 0 && (
            <div style={{ marginTop: 4 }}>
              👤 <b>缺角色定妆图</b>: {missingPrompt.chars.join('、')}
            </div>
          )}
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}>
            「先补全再生成」会用免费生图模型补齐缺失项 (消耗生图额度)，完成后自动继续生成视频。
          </div>
        </div>
      </Modal>

      {/* 2026-10-14: 尾帧衔接 — 上一镜无可用尾帧时的询问 (先补上一镜 / 跳过直接生成 / 取消) */}
      <Modal
        open={!!continuityPrompt}
        title="接不上上一镜"
        width={460}
        onCancel={() => { continuityPrompt?.resolve('cancel'); setContinuityPrompt(null); }}
        footer={[
          <Button key="fill" type="primary" onClick={() => { continuityPrompt?.resolve('fill'); setContinuityPrompt(null); }}>
            先补上一镜 (推荐)
          </Button>,
          <Button key="skip" onClick={() => { continuityPrompt?.resolve('skip'); setContinuityPrompt(null); }}>
            跳过直接生成
          </Button>,
          <Button key="cancel" onClick={() => { continuityPrompt?.resolve('cancel'); setContinuityPrompt(null); }}>取消</Button>,
        ]}
      >
        <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7 }}>
          <>第 <b>{continuityPrompt?.prevShotId}</b> 镜<b>还没生成</b>, 本镜没有尾帧可接。</>
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}>
            「先补上一镜」会先生成上一镜 (完成后请再点本镜), 这样本镜就能接上戏;<br />
            「跳过直接生成」则本镜只靠场景图/角色图生成 (会标 ⚠ 无衔接, 动作可能接不上)。
          </div>
        </div>
      </Modal>

      {/* 场景精编器 — 全屏 */}
      {editingScene !== null && storyboard && storyboard.episodes[editingScene] && (
        <SceneEditor
          httpUrl={httpUrl}
          sceneImage={storyboard.episodes[editingScene].scene?.imageUrl}
          characters={storyboard.characters.map(c => ({ name: c.name, portraitUrl: c.portraitUrl }))}
          onSave={(composedUrl) => {
            setStoryboard(prev => {
              if (!prev) return prev;
              const eps = [...prev.episodes];
              if (eps[editingScene]?.scene) {
                eps[editingScene].scene.imageUrl = composedUrl;
              }
              return { ...prev, episodes: eps };
            });
            setEditingScene(null);
          }}
          onClose={() => setEditingScene(null)}
        />
      )}
    </div>
  );
};
