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
import { Button, Input, InputNumber, Select, Card, Space, Tag, Tooltip, message, Spin, Progress, Collapse, Checkbox, Upload, Modal, Alert } from 'antd';
import {
  ThunderboltOutlined, DeleteOutlined, VideoCameraOutlined,
  PictureOutlined, PlusOutlined, UserOutlined, CameraOutlined, EditOutlined,
  FolderOutlined, FolderOpenOutlined, FileOutlined,
} from '@ant-design/icons';
import { SceneEditor } from './SceneEditor';

const { TextArea } = Input;
const { Panel } = Collapse;

export interface Shot {
  id: number;
  type: string;
  duration: string;
  camera_motion: string;
  mood: string;
  prompt: string;
  characters: string[];
  dialogue: string;
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  videoUrl?: string;
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

// 右侧折叠面板的 CSS — 折叠时只显示 header, 展开时自动填充
const RIGHT_COLLAPSE_CSS = `
.storyboard-right-collapse .ant-collapse-content {
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
        shots: ep.shots.map(s => ({ ...s, videoUrl: s.videoUrl?.startsWith('http') || s.videoUrl?.startsWith('/api/') ? s.videoUrl : undefined })),
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
            shots: ep.shots.map(s => ({ ...s, videoUrl: s.videoUrl?.startsWith('http') ? s.videoUrl : undefined })),
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
        setActiveId(id);
        setStoryboard(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ list: storyboardList, activeId: id }));
        message.success(`已切换到: ${data.title}`);
      }
    } catch { message.error('切换失败'); }
  };

  // 删除剧本
  const deleteStoryboard = (id: string) => {
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
    setStoryboard(null);
    setActiveId(null);
    setPrompt('');
    message.info('已新建空白剧本, 输入创意后生成');
  };
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [generatingPortrait, setGeneratingPortrait] = useState<string | null>(null);
  const [generatingScene, setGeneratingScene] = useState<number | null>(null); // epIdx
  const [zoomPortrait, setZoomPortrait] = useState<{ url: string; name: string } | null>(null);
const [zoomScene, setZoomScene] = useState<{ url: string; name: string } | null>(null);
const [generatingSequel, setGeneratingSequel] = useState<number | null>(null); // 正在生成续集的集号
const [editingScene, setEditingScene] = useState<number | null>(null); // 正在精编的集号
// 右侧面板折叠状态 — 默认折叠, 编辑时更清爽
const [rightPanelExpanded, setRightPanelExpanded] = useState<string[]>([]); // ['preview'] / ['export'] / 两者

  // 生成剧本
  const generateStoryboard = async () => {
    if (!prompt.trim()) { message.warning('请输入创意描述'); return; }
    setGenerating(true);
    try {
      const resp = await fetch(`${httpUrl}/v1/video/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, episodeCount, durationPerShot: String(shotDuration), refImages }),
      });
      const data = await resp.json();
      if (data.error) { message.error('剧本生成失败: ' + data.error); return; }
      if (data.ok && data.storyboard) {
        const sb = data.storyboard as Storyboard;
        sb.episodes.forEach(ep => ep.shots.forEach(s => { s.selected = true; s.status = 'pending'; }));
        setStoryboard(sb);
        message.success(`✅ 剧本已生成: ${sb.title}`);
      }
    } catch (e: any) { message.error('剧本生成失败: ' + e.message); }
    finally { setGenerating(false); }
  };

  // AI 生成角色图 — 同时生成定妆图(白底单人照, 用于精编抠图) + 九宫格(多角度参考, 用于AI理解角色)
  const generatePortrait = async (charName: string) => {
    if (!storyboard) return;
    const char = storyboard.characters.find(c => c.name === charName);
    if (!char) return;
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

      setStoryboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          characters: prev.characters.map(c => c.name === charName
            ? { ...c, portraitUrl: portraitUrl || c.portraitUrl, sheetUrl: sheetUrl || c.sheetUrl }
            : c
          ),
        };
      });

      const okCount = (portraitUrl ? 1 : 0) + (sheetUrl ? 1 : 0);
      if (portraitData.error && sheetData.error) {
        message.error(`角色图生成失败: ${portraitData.error}`);
      } else {
        message.success(`✅ ${charName} 角色图已生成 (${okCount}/2 成功${portraitUrl ? ' · 定妆图' : ''}${sheetUrl ? ' · 九宫格' : ''})`);
      }
    } catch (e: any) { message.error('角色图生成失败: ' + e.message); }
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
  const generateSceneImage = async (epIdx: number) => {
    if (!storyboard) return;
    const ep = storyboard.episodes[epIdx];
    if (!ep || !ep.scene) return;
    setGeneratingScene(epIdx);
    try {
      const scenePrompt = `Photorealistic scene background: ${ep.scene.description}. 
Wide establishing shot, no people, no characters, environment only. 
Cinematic lighting, natural colors, realistic photography style. 
High detail, professional quality, 16:9 aspect ratio.`;
      const resp = await fetch(`${httpUrl}/v1/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: scenePrompt, model: 'agnes', mode: 'text2img', size: '2K' }),
      });
      const data = await resp.json();
      if (data.error) { message.error(`场景图生成失败: ${data.error}`); return; }
      const url = data.url?.startsWith('/') ? httpUrl + data.url : data.url;
      setStoryboard(prev => {
        if (!prev) return prev;
        const eps = [...prev.episodes];
        eps[epIdx] = { ...eps[epIdx], scene: { ...eps[epIdx].scene!, imageUrl: url } };
        return { ...prev, episodes: eps };
      });
      message.success(`✅ 第${epIdx + 1}集场景图已生成`);
    } catch (e: any) { message.error('场景图生成失败: ' + e.message); }
    finally { setGeneratingScene(null); }
  };

  // 智能续集 — 基于上一集剧情+尾帧, AI 生成新的分镜剧本
  const generateSequel = async (fromEpIdx: number) => {
    if (!storyboard) return;
    const ep = storyboard.episodes[fromEpIdx];
    if (!ep) return;
    // 收集上一集剧情: 所有镜头的 prompt
    const epPrompts = ep.shots.map(s => s.prompt).join('\n');
    // 获取最后一镜的尾帧 URL
    const lastShot = ep.shots[ep.shots.length - 1];
    const apiLastFrame = lastShot?.videoUrl ? undefined : undefined; // TODO: 从 shot 状态中获取 lastFrameUrl

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

      setStoryboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          characters: [...prev.characters, ...newChars],
          episodes: [...prev.episodes, newEpisode],
        };
      });

      message.success(`✅ 智能续集已生成: ${newEpisode.title} (${newEpisode.shots.length} 镜)${data.warning ? '\n⚠️ ' + data.warning : ''}`);
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
  const submitVideoTask = async (body: any, onRetry?: (retry: number, msg: string) => void): Promise<{ taskId: string } | { error: string }> => {
    for (let retry = 0; retry < 5; retry++) {
      const resp = await fetch(`${httpUrl}/v1/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (data.taskId) return { taskId: data.taskId };
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
  const collectRefImages = (epIdx: number, shot: Shot): string[] => {
    if (!storyboard) return [];
    const refs: string[] = [];
    // 1. 场景图
    const ep = storyboard.episodes[epIdx];
    if (ep?.scene?.imageUrl) {
      refs.push(ep.scene.imageUrl);
    }
    // 2. 角色定妆图 + 九宫格 — 只传该镜头涉及的角色
    if (shot.characters && shot.characters.length > 0) {
      for (const charName of shot.characters) {
        const char = storyboard.characters.find(c => c.name === charName);
        if (char?.portraitUrl) {
          refs.push(char.portraitUrl);
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
        if (char.portraitUrl) {
          refs.push(char.portraitUrl);
          if (refs.length >= 5) break;
        }
      }
    }
    return refs.slice(0, 5); // Agnes Flash 最多5张
  };

  // 单镜生成 — 用户逐个点击, 适合 Flash 免费模型 (有速率限制)
  const generateSingleShot = async (epIdx: number, shotId: number) => {
    if (!storyboard) return;
    const ep = storyboard.episodes[epIdx];
    const shot = ep.shots.find(s => s.id === shotId);
    if (!shot) return;
    if (shot.status === 'generating') return;

    setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'generating', error: undefined } : s); return { ...prev, episodes: eps }; });

    try {
      // 收集角色定妆图+场景图作为参考
      const refImages = collectRefImages(epIdx, shot);
      const body: any = { prompt: shot.prompt, model, duration: `${shot.duration}s`, size: '720P', aspect_ratio: '16:9' };
      // 有参考图时用 reference 模式
      if (refImages.length > 0) {
        body.images = refImages;
      }
      const result = await submitVideoTask(body, (retry, msg) => {
        setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'generating', error: msg } : s); return { ...prev, episodes: eps }; });
      });
      if ('error' in result) {
        setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: result.error } : s); return { ...prev, episodes: eps }; });
        return;
      }
      const videoResult = await pollVideo(result.taskId, model);
      if (videoResult) {
        setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'completed', videoUrl: videoResult.videoUrl, error: undefined } : s); return { ...prev, episodes: eps }; });
        message.success(`第${epIdx + 1}集-${shotId}镜 生成完成`);
      } else {
        setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: '轮询超时或任务失败' } : s); return { ...prev, episodes: eps }; });
      }
    } catch (e: any) {
      setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shotId ? { ...s, status: 'failed', error: e.message } : s); return { ...prev, episodes: eps }; });
    }
  };

  // 批量生成 — 支持所有模型, Flash 模型自动延迟避免速率限制
  const isFlashModel = model === 'agnes' || model.includes('flash');
  const batchGenerate = async () => {
    if (!storyboard) return;
    const allShots = storyboard.episodes.flatMap(ep => ep.shots.filter(s => s.selected && s.status !== 'completed'));
    if (allShots.length === 0) { message.warning('没有需要生成的镜头'); return; }
    // Flash 模型警告
    if (isFlashModel && allShots.length > 3) {
      message.warning(`Flash 免费模型有速率限制, ${allShots.length} 镜将逐个生成 (每镜间隔 10s), 预计耗时较长`);
    }
    setBatchGenerating(true);
    setBatchProgress(0);
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    for (let epIdx = 0; epIdx < storyboard.episodes.length; epIdx++) {
      const ep = storyboard.episodes[epIdx];
      for (const shot of ep.shots) {
        if (!shot.selected || shot.status === 'completed') continue;

        setStoryboard(prev => {
          if (!prev) return prev;
          const eps = [...prev.episodes];
          eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'generating' } : s);
          return { ...prev, episodes: eps };
        });

          try {
            // 收集角色定妆图+场景图作为参考
            const refImages = collectRefImages(epIdx, shot);
            const body: any = { prompt: shot.prompt, model, duration: `${shot.duration}s`, size: '720P', aspect_ratio: '16:9' };
            if (refImages.length > 0) {
              body.images = refImages;
            }
            const result = await submitVideoTask(body, (retry, msg) => {
              setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'generating', error: msg } : s); return { ...prev, episodes: eps }; });
            });
            if ('error' in result) {
              failed++;
              setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: result.error } : s); return { ...prev, episodes: eps }; });
            } else {
              const videoResult = await pollVideo(result.taskId, model);
              if (videoResult) {
                succeeded++;
                setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'completed', videoUrl: videoResult.videoUrl, error: undefined } : s); return { ...prev, episodes: eps }; });
              } else {
                failed++;
                setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: '轮询超时或任务失败' } : s); return { ...prev, episodes: eps }; });
              }
            }
          } catch (e: any) {
          failed++;
          setStoryboard(prev => { if (!prev) return prev; const eps = [...prev.episodes]; eps[epIdx].shots = eps[epIdx].shots.map(s => s.id === shot.id ? { ...s, status: 'failed', error: e.message } : s); return { ...prev, episodes: eps }; });
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
    const failMsg = failed > 0 ? `, ${failed} 镜失败` : '';
    message.info(`批量生成完成: ${succeeded} 镜成功${failMsg}`, 5);
  };

  const pollVideo = (taskId: string, modelName: string): Promise<{ videoUrl: string; lastFrameUrl?: string } | null> => {
    return new Promise((resolve) => {
      let attempts = 0;
      let consecutiveErrors = 0;
      const interval = setInterval(async () => {
        if (++attempts > 60) { clearInterval(interval); resolve(null); return; }
        try {
          const queryUrl = `${httpUrl}/v1/video/query?taskId=${taskId}&model=${modelName === 'agnes-video-2.5' ? 'agnes-video-2.5' : 'agnes'}`;
          const resp = await fetch(queryUrl);
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

return (
<div style={{ display: 'flex', gap: 12, height: '100%' }}>
<style>{RIGHT_COLLAPSE_CSS}</style>
{/* 左侧: 输入 + 角色卡 + 分镜列表 */}
      <div style={{ width: '55%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', paddingRight: 4 }}>
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
              <Tooltip title="新建剧本 (当前剧本已自动保存)">
                <Button size="small" icon={<PlusOutlined />} onClick={newStoryboard} />
              </Tooltip>
              {storyboard && activeId && (
                <Tooltip title="删除当前剧本">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteStoryboard(activeId)} />
                </Tooltip>
              )}
            </Space>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <TextArea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="描述你的创意, 例: 一个建筑从地基到完工的生长动画, 5集"
              autoSize={{ minRows: 2, maxRows: 6 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>集数:</span>
              <InputNumber min={1} max={20} value={episodeCount} onChange={v => setEpisodeCount(v || 1)} size="small" style={{ width: 60 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>单镜时长:</span>
              <Select size="small" value={shotDuration} onChange={v => setShotDuration(v)} style={{ width: 80 }}
                options={[{ value: 4, label: '4s' }, { value: 5, label: '5s' }, { value: 8, label: '8s' }, { value: 10, label: '10s' }]} />
              <div style={{ flex: 1 }} />
              <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={generateStoryboard}>
                {generating ? '生成中...' : '生成剧本'}
              </Button>
            </div>
            {refImages.length > 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}><PictureOutlined /> 已上传 {refImages.length} 张参考图</div>}
          </div>
        </Card>

        {/* 角色卡区域 — 独立面板 */}
        {storyboard?.characters && storyboard.characters.length > 0 && (
          <Card size="small" title={<Space><UserOutlined /> 角色卡 ({storyboard.characters.length})</Space>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {storyboard.characters.map((char, i) => (
                <div key={i} style={{ padding: 8, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)' }}>
                  {/* 定妆图 — 点击查看大图 */}
                  <div style={{ width: '100%', height: 140, borderRadius: 6, overflow: 'hidden', marginBottom: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: char.portraitUrl ? 'zoom-in' : 'default', position: 'relative' }}
                    onClick={() => char.portraitUrl && setZoomPortrait({ url: char.portraitUrl, name: char.name })}>
                    {char.portraitUrl ? (
                      <img src={char.portraitUrl} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : generatingPortrait === char.name ? (
                      <Spin tip="生成中..." />
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                        <UserOutlined style={{ fontSize: 32 }} />
                        <div style={{ fontSize: 10, marginTop: 4 }}>暂无定妆图</div>
                      </div>
                    )}
                    {char.portraitUrl && (
                      <div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 3 }}>🔍 点击放大</div>
                    )}
                  </div>
                  {/* 角色信息 */}
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{char.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.4 }}>{char.description}</div>
                  {char.refImageIndex !== undefined && refImages[char.refImageIndex] && (
                    <Tag color="blue" style={{ fontSize: 10, marginBottom: 4 }}>参考图 {char.refImageIndex + 1}</Tag>
                  )}
                  {/* 九宫格缩略图 — 点击查看大图 */}
                  {char.sheetUrl && (
                    <div style={{ marginBottom: 6, cursor: 'zoom-in' }}
                      onClick={() => setZoomPortrait({ url: char.sheetUrl!, name: `${char.name} — 九宫格参考` })}>
                      <img src={char.sheetUrl} alt={`${char.name} 九宫格`} style={{ width: '100%', borderRadius: 4, border: '1px solid var(--border)' }} />
                      <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>📋 九宫格参考 (点击放大)</div>
                    </div>
                  )}
                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button size="small" type="primary" ghost icon={<CameraOutlined />} loading={generatingPortrait === char.name}
                      onClick={() => generatePortrait(char.name)} style={{ fontSize: 11, flex: 1 }}>生成角色图</Button>
                    <Upload showUploadList={false} beforeUpload={(file) => { uploadPortrait(char.name, file); return false; }}>
                      <Button size="small" icon={<PictureOutlined />} style={{ fontSize: 11 }}>上传</Button>
                    </Upload>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 批量生成进度 */}
        {batchGenerating && (
          <Card size="small"><Progress percent={batchProgress} status="active" /><div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>批量生成中... {batchProgress}%</div></Card>
        )}

        {/* 批量生成按钮 — 仅商业模型显示, Flash 免费模型由用户逐镜生成 */}
        {storyboard && selectedShots > 0 && !batchGenerating && !isFlashModel && (
          <Button type="primary" size="large" icon={<VideoCameraOutlined />} onClick={batchGenerate}
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 10 }}>
            批量生成 ({selectedShots} 镜)
          </Button>
        )}
        {storyboard && isFlashModel && (
          <Alert type="info" showIcon style={{ fontSize: 11 }}
            message="当前为 Flash 免费模型, 有速率限制"
            description="请逐镜点击「生成」按钮, 一个一个生成。切换到商业模型可批量生成。" />
        )}

        {/* 分集列表 */}
        {storyboard && (
          <Collapse defaultActiveKey={storyboard.episodes.map(e => String(e.index))}>
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
                      style={{ fontSize: 10 }}>
                      智能续集
                    </Button>
                  )}
                </Space>
              }>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* 场景卡 — 每集固定场景, 保证跨集一致 */}
                  {ep.scene && (
                    <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 4 }}>
                      <div style={{ width: 160, height: 90, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: ep.scene.imageUrl ? 'zoom-in' : 'default', position: 'relative' }}
                        onClick={() => ep.scene?.imageUrl && setZoomScene({ url: ep.scene.imageUrl, name: `第${ep.index}集 场景: ${ep.scene.name}` })}>
                        {ep.scene.imageUrl ? (
                          <img src={ep.scene.imageUrl} alt={ep.scene.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : generatingScene === epIdx ? (
                          <Spin size="small" />
                        ) : (
                          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 10 }}><PictureOutlined style={{ fontSize: 20 }} /><br />暂无场景图</div>
                        )}
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>🎬 {ep.scene.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 4 }}>{ep.scene.description}</div>
                        <Button size="small" type="primary" ghost icon={<CameraOutlined />} loading={generatingScene === epIdx}
                          onClick={() => generateSceneImage(epIdx)} style={{ fontSize: 10, width: 'fit-content' }}>
                          {ep.scene.imageUrl ? '重新生成场景' : '生成场景图'}
                        </Button>
                        {ep.scene.imageUrl && (
                          <Button size="small" type="primary" icon={<EditOutlined />}
                            onClick={() => setEditingScene(epIdx)} style={{ fontSize: 10, marginLeft: 4 }}>
                            精编
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {ep.shots.map((shot) => (
                    <div key={shot.id} style={{
                      padding: 8, borderRadius: 8, background: 'var(--panel)',
                      border: `1px solid ${shot.status === 'completed' ? '#52c41a' : shot.status === 'failed' ? '#ff4d4f' : shot.status === 'generating' ? '#faad14' : 'var(--border)'}`,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Checkbox checked={shot.selected} onChange={() => toggleShot(epIdx, shot.id)} />
                          <Tag>{shot.type}</Tag><Tag color="blue">{shot.duration}s</Tag>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shot.camera_motion} · {shot.mood}</span>
                          <div style={{ flex: 1 }} />
                          {shot.characters?.map((c, i) => <Tag key={i} color="purple" style={{ fontSize: 10 }}>{c}</Tag>)}
                          {shot.status === 'completed' && <Tag color="green">✓</Tag>}
                          {shot.status === 'generating' && <Spin size="small" />}
                          {shot.status === 'failed' && <Tag color="red">失败</Tag>}
                          <Button size="small" type="primary" loading={shot.status === 'generating'} disabled={shot.status === 'generating' || shot.status === 'completed'}
                            onClick={() => generateSingleShot(epIdx, shot.id)} style={{ fontSize: 10, padding: '0 6px' }}>
                            {shot.status === 'generating' ? '生成中' : shot.status === 'failed' ? '重试' : shot.status === 'completed' ? '已生成' : '生成'}
                          </Button>
                          <Tooltip title="删除"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteShot(epIdx, shot.id)} /></Tooltip>
                        </div>
                      <TextArea value={shot.prompt} onChange={e => updateShotPrompt(epIdx, shot.id, e.target.value)}
                        autoSize={{ minRows: 2, maxRows: 6 }} style={{ fontSize: 12 }} disabled={shot.status === 'generating'} />
                      {shot.dialogue && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>台词: "{shot.dialogue}"</div>}
                      {shot.error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{shot.error}</div>}
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </Collapse>
        )}
      </div>

      {/* 右侧: 可折叠 — 分镜预览 + 剧集成品, 默认折叠让编辑区更清爽 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                  <span style={{ fontSize: 13, fontWeight: 600 }}>分镜预览</span>
                  <Tag style={{ fontSize: 9 }}>
                    {storyboard.episodes.reduce((sum, ep) => sum + ep.shots.filter(s => s.videoUrl).length, 0)} 个视频
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
                    <div style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 4px', color: 'var(--fg-2)' }}>第 {ep.index} 集 · {ep.title}</div>
                    {ep.shots.filter(s => s.videoUrl).length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--muted-2)', padding: 4 }}>暂无已生成的视频 · 可从其他集拖拽镜头到此</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                        {ep.shots.filter(s => s.videoUrl).map(shot => (
                          <div key={shot.id} style={{ position: 'relative' }}
                            draggable
                            onDragStart={() => setDragShot({ epIdx: ep.index - 1, shotId: shot.id })}
                            onDragEnd={() => setDragShot(null)}>
                            <video src={shot.videoUrl} controls style={{ width: '100%', borderRadius: 6, background: '#000' }} />
                            <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
                              {ep.index}-{shot.id} · {shot.type}
                            </div>
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
                  <span style={{ fontSize: 13, fontWeight: 600 }}>剧集成品 · 拼接导出</span>
                  <Tag style={{ fontSize: 9 }} color="green">
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
                    <div key={ep.index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)', marginBottom: 4 }}>
                      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: isComplete ? '#52c41a' : 'var(--bg)', color: isComplete ? '#fff' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {ep.index}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{completedShots.length}/{totalShots} 镜已完成</div>
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
                          style={{ fontSize: 10 }}>
                          拼接播放
                        </Button>
                      ) : (
                        <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 3px' }} color="orange">未完成</Tag>
                      )}
                    </div>
                  );
                })}
                <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 6, textAlign: 'center' }}>
                  所有镜头生成完毕后, 点击「拼接播放」自动合并为完整剧集视频 (需后端 ffmpeg 支持)。
                </div>
              </div>
            </Panel>
          </Collapse>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--muted)' }}>
            <VideoCameraOutlined style={{ fontSize: 40, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>剧本分镜</div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>输入创意 → 生成剧本 → 编辑分镜 → 逐镜生成</div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 8 }}>右侧可折叠: 分镜预览 · 剧集成品拼接</div>
          </div>
        )}
       </div>

      {/* 角色九宫格大图查看 Modal */}
      <Modal open={!!zoomPortrait} title={zoomPortrait?.name ? `${zoomPortrait.name} — 定妆图` : '角色图'}
        footer={null} width="90%" style={{ top: 20 }}
        onCancel={() => setZoomPortrait(null)}>
        {zoomPortrait && (
          <img src={zoomPortrait.url} alt={zoomPortrait.name} style={{ width: '100%', borderRadius: 8 }} />
        )}
      </Modal>

      {/* 场景图大图查看 Modal */}
      <Modal open={!!zoomScene} title={zoomScene?.name || '场景图'}
        footer={null} width="90%" style={{ top: 20 }}
        onCancel={() => setZoomScene(null)}>
        {zoomScene && (
          <img src={zoomScene.url} alt={zoomScene.name} style={{ width: '100%', borderRadius: 8 }} />
        )}
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
