/**
 * VoiceSettings — 音色选择设置面板
 * -------------------------------------------------
 * 嵌入 Composer 底栏，点击音色图标展开。
 * 支持：播报开关、音色选择、TTS引擎选择、语速调节、音调调节、试听。
 *
 * 引擎与音色联动：
 *   - browser → 浏览器内置 TTS（音色来自 speechSynthesis.getVoices()）
 *   - openai  → 云端 OpenAI TTS（音色来自后端 /v1/tts/voices）
 *   - moss    → MOSS 本地 TTS（音色来自后端 /v1/tts/voices）
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tooltip, Slider, Select, Switch, Button, Spin, Progress } from 'antd';
import { SoundOutlined, CustomerServiceOutlined, CloseOutlined, DownloadOutlined } from '@ant-design/icons';
import { isTtsEnabled, setTtsEnabled, stopTts } from '../services/VoiceService';
import { speakText, getAvailableVoices, speakWithApi } from '../services/voice';

/* ===== 类型 ===== */
export interface VoiceSettingsState {
  enabled: boolean;
  engine: 'browser' | 'openai' | 'moss' | 'agnes';
  voice: string;
  rate: number;
  pitch: number;
}

interface ApiVoice {
  id: string;
  name: string;
  gender: string;
  provider: string;
}

const STORAGE_KEY = 'agentai.tts.settings';

const ENGINE_OPTIONS = [
  { value: 'browser' as const, label: '浏览器内置 TTS' },
  { value: 'agnes' as const, label: 'Agnes Audio TTS' },
  { value: 'moss' as const, label: 'MOSS 本地 TTS' },
  // NVIDIA Chatterbox 已移除 (NIM 不可用)
];

const ENGINE_PROVIDER_MAP: Record<string, string> = {
  browser: 'browser',
  agnes: 'agnes',
  moss: 'moss',
  // nvidia 已移除
};

// 中文命名音色映射: browser 引擎下用中文名替代 Microsoft Huihui 等英文名
const BROWSER_VOICE_NAME_MAP: Record<string, string> = {
  'zh-CN-XiaoxiaoNeural': '晓晓',
  'zh-CN-YunxiNeural': '云希',
  'zh-CN-YunjianNeural': '云健',
  'zh-CN-XiaoyiNeural': '晓伊',
  'zh-CN-YunyangNeural': '云扬',
  'zh-CN-XiaochenNeural': '晓辰',
  'zh-CN-XiaohanNeural': '晓涵',
  'zh-CN-XiaomengNeural': '晓梦',
  'zh-CN-YunfengNeural': '云枫',
  'zh-CN-YunhaoNeural': '云皓',
  'zh-HK-HiuMaanNeural': '晓曼(粤语)',
  'zh-HK-WanLungNeural': '云龙(粤语)',
  'zh-TW-HsiaoChenNeural': '晓臻(台湾)',
  'zh-TW-YunJheNeural': '云哲(台湾)',
  'en-US-AriaNeural': 'Aria (EN)',
  'en-US-GuyNeural': 'Guy (EN)',
  'ja-JP-NanamiNeural': '七海 (JP)',
  'ko-KR-SunHiNeural': '善熙 (KR)',
};

// browser 引擎下优先使用的中文音色 ID 列表
const PREFERRED_BROWSER_VOICES = [
  'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural',
  'zh-CN-XiaoyiNeural', 'zh-CN-YunyangNeural', 'zh-CN-XiaochenNeural',
  'zh-CN-XiaohanNeural', 'zh-CN-XiaomengNeural', 'zh-CN-YunfengNeural', 'zh-CN-YunhaoNeural',
  'zh-HK-HiuMaanNeural', 'zh-HK-WanLungNeural', 'zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural',
  'en-US-AriaNeural', 'en-US-GuyNeural', 'ja-JP-NanamiNeural', 'ko-KR-SunHiNeural',
];

function loadSettings(): VoiceSettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 兼容旧数据: api → openai
      if (parsed.engine === 'api') parsed.engine = 'openai';
      return parsed;
    }
  } catch {}
  return { enabled: false, engine: 'browser', voice: '', rate: 1.0, pitch: 1.0 };
}

function saveSettings(s: VoiceSettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/* ===== Component ===== */
interface Props {
  state: VoiceSettingsState;
  onChange: (s: VoiceSettingsState) => void;
  /** 外部强制打开 (从菜单触发) */
  externalOpen?: boolean;
  /** 外部打开状态重置回调 */
  onExternalOpenConsumed?: () => void;
}

const VoiceSettings: React.FC<Props> = ({ state, onChange, externalOpen, onExternalOpenConsumed }) => {
  const [open, setOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [apiVoices, setApiVoices] = useState<ApiVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  // MOSS 下载状态
  const [mossStatus, setMossStatus] = useState<{
    phase: string; progress: number; message: string; ready: boolean;
    error?: string; modelsExist?: { ttsModelExists: boolean; audioTokenizerExists: boolean };
    download?: { phase: string; progress: number; message?: string; error?: string };
  } | null>(null);
  const [mossChecking, setMossChecking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 获取浏览器可用音色
  useEffect(() => {
    const load = () => setBrowserVoices(getAvailableVoices());
    load();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load;
    }
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // 面板展开时拉后端音色
  useEffect(() => {
    if (!open) return;
    (async () => {
      setVoicesLoading(true);
      try {
        const resp = await fetch('/v1/tts/voices');
        if (resp.ok) {
          const data = await resp.json();
          setApiVoices(data.voices || []);
        }
      } catch { /* 忽略 */ }
      setVoicesLoading(false);
    })();
  }, [open]);

  // MOSS 引擎时轮询下载/服务状态
  useEffect(() => {
    if (!open || state.engine !== 'moss') {
      setMossStatus(null);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const resp = await fetch('/v1/tts/moss/status');
        if (resp.ok) {
          const data = await resp.json();
          setMossStatus(data);
          setMossChecking(false);
          // 如果下载完成或出错，停止轮询
          if (data.download?.phase === 'complete' || data.download?.phase === 'error') {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
          }
        }
      } catch { /* 网络错误：gateway 可能未启动 */ }
    };

    setMossChecking(true);
    poll();
    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [open, state.engine]);

  // 外部触发打开
  useEffect(() => {
    if (externalOpen) {
      setOpen(true);
      onExternalOpenConsumed?.();
    }
  }, [externalOpen, onExternalOpenConsumed]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = useCallback(() => {
    const next = !state.enabled;
    const newState = { ...state, enabled: next };
    setTtsEnabled(next);
    if (!next) stopTts();
    onChange(newState);
    saveSettings(newState);
  }, [state, onChange]);

  const updateField = useCallback(<K extends keyof VoiceSettingsState>(key: K, value: VoiceSettingsState[K]) => {
    const newState = { ...state, [key]: value };
    onChange(newState);
    saveSettings(newState);
  }, [state, onChange]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    const text = '你好，欢迎使用语音合成系统。';
    try {
      if (state.engine === 'browser') {
        speakText(text, {
          voice: state.voice || undefined,
          rate: state.rate,
          pitch: state.pitch,
          onDone: () => setTesting(false),
        });
      } else {
        await speakWithApi(text, {
          voice: state.voice || undefined,
          speed: state.rate,
          provider: state.engine,
        });
        setTesting(false);
      }
    } catch {
      // fallback browser
      speakText(text, {
        voice: state.voice || undefined,
        rate: state.rate,
        pitch: state.pitch,
        onDone: () => setTesting(false),
      });
    }
  }, [state]);

  // ——— 音色选项 ———
  const currentProvider = ENGINE_PROVIDER_MAP[state.engine] || state.engine;

  let voiceOptions: { value: string; label: string }[];
  if (state.engine === 'browser') {
    // browser 引擎: 使用中文命名列表 (与设置页 VoiceSelector 一致)
    // 实际播放时通过 browserVoices 匹配对应的 Microsoft 语音
    const zhVoices = PREFERRED_BROWSER_VOICES
      .filter(id => BROWSER_VOICE_NAME_MAP[id])
      .map(id => ({
        value: id,
        label: BROWSER_VOICE_NAME_MAP[id],
      }));
    // 追加浏览器中其他可用中文语音 (不在预设列表中的)
    const existingIds = new Set(PREFERRED_BROWSER_VOICES);
    const extraVoices = browserVoices
      .filter(v => v.lang?.startsWith('zh') && !existingIds.has(v.name))
      .map(v => ({ value: v.name, label: `${v.name} (${v.lang})` }));
    voiceOptions = [...zhVoices, ...extraVoices];
  } else {
    // agnes 引擎: 同时显示 agnes 和 edge 提供商的音色（共享 Azure Neural 音色名）
    // moss 引擎: 只显示 moss 音色
    // 其他引擎: 精确匹配 provider
    const isAgnesEngine = state.engine === 'agnes';
    voiceOptions = apiVoices
      .filter(v => {
        if (isAgnesEngine) return v.provider === 'agnes' || v.provider === 'edge';
        return v.provider === currentProvider;
      })
      .map(v => ({
        value: v.id,
        label: `${v.name}${v.gender !== 'neutral' ? ` (${v.gender === 'male' ? '男' : '女'})` : ''}`,
      }));
    // 如果 agnes 引擎没有可用音色，提示用户
    if (isAgnesEngine && voiceOptions.length === 0) {
      voiceOptions = [{ value: '', label: '无可用音色 (将使用 Edge TTS)' }];
    }
  }

  return (
    <>
      {/* 音色选择入口图标 */}
      <Tooltip title={state.enabled ? '音色设置' : '开启语音播报'}>
        <button
          ref={btnRef}
          onClick={() => state.enabled ? setOpen(v => !v) : toggle()}
          style={{
            position: 'relative',
            width: 24, height: 24, borderRadius: 4,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', border: 'none',
            color: state.enabled ? '#6366F1' : 'var(--muted-2)',
            background: state.enabled ? 'rgba(99,102,241,0.12)' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          <SoundOutlined style={{ fontSize: 12 }} />
          {state.enabled && (
            <span style={{
              position: 'absolute', top: 1, right: 1,
              width: 5, height: 5, borderRadius: '50%',
              background: '#22c55e',
            }} />
          )}
        </button>
      </Tooltip>

      {/* 展开面板 */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute', bottom: 44, left: 8,
            width: 340,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: '12px 14px',
            zIndex: 1000,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          {/* 标题 + 关闭 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
              <CustomerServiceOutlined style={{ marginRight: 6, color: '#6366F1' }} />
              语音播报设置
            </span>
            <span
              onClick={() => setOpen(false)}
              style={{ cursor: 'pointer', color: 'var(--muted-2)', fontSize: 12, padding: 2 }}
            >
              <CloseOutlined />
            </span>
          </div>

          <div style={{ height: 1, background: 'var(--border)' }} />

          {/* 播报开关 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--fg)' }}>AI 回复语音播报</span>
            <Switch size="small" checked={state.enabled} onChange={toggle} />
          </div>

          {/* TTS 引擎 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--fg)' }}>TTS 引擎</span>
            <Select
              size="small"
              value={state.engine}
              onChange={(v) => updateField('engine', v)}
              style={{ width: 150 }}
              variant="borderless"
              options={ENGINE_OPTIONS}
            />
          </div>

          {/* MOSS 下载进度 */}
          {state.engine === 'moss' && mossStatus?.download?.phase === 'downloading' && (
            <div style={{ background: 'rgba(99,102,241,0.08)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <DownloadOutlined style={{ color: '#6366F1', fontSize: 12 }} />
                <span style={{ fontSize: 11, color: 'var(--fg)' }}>正在下载模型 (~2GB)</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                  {mossStatus.download.progress}%
                </span>
              </div>
              <Progress
                percent={mossStatus.download.progress}
                size="small"
                showInfo={false}
                strokeColor="#6366F1"
                trailColor="rgba(99,102,241,0.15)"
              />
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 4 }}>
                {mossStatus.download.message || '正在通过 HuggingFace 镜像下载...'}
              </div>
            </div>
          )}

          {/* MOSS 下载失败 */}
          {state.engine === 'moss' && mossStatus?.download?.phase === 'error' && (
            <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '8px 10px' }}>
              <span style={{ fontSize: 11, color: '#ef4444' }}>
                模型下载失败: {mossStatus.download.error || '未知错误'}
              </span>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 4 }}>
                将使用浏览器 TTS 作为备用
              </div>
            </div>
          )}

          {/* MOSS 加载中/检查中 */}
          {state.engine === 'moss' && mossChecking && !mossStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
              <Spin size="small" />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>检查 MOSS 服务状态...</span>
            </div>
          )}

          {/* 音色选择（所有引擎共用，数据源不同） */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--fg)' }}>音色</span>
            {voicesLoading && state.engine !== 'browser' ? (
              <Spin size="small" style={{ marginRight: 8 }} />
            ) : (
              <Select
                size="small"
                value={state.voice || undefined}
                onChange={(v) => updateField('voice', v || '')}
                style={{ width: 190 }}
                variant="borderless"
                placeholder="默认音色"
                allowClear
                options={voiceOptions}
                notFoundContent={state.engine !== 'browser' ? '无可用音色（服务未就绪）' : undefined}
              />
            )}
          </div>

          {/* 语速（所有引擎通用） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--fg)', width: 50, flexShrink: 0 }}>语速</span>
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={state.rate}
              onChange={(v) => updateField('rate', v)}
              style={{ flex: 1, margin: '0 4px' }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)', width: 30, textAlign: 'right' }}>
              {state.rate.toFixed(1)}x
            </span>
          </div>

          {/* 音调（所有引擎通用） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--fg)', width: 50, flexShrink: 0 }}>音调</span>
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={state.pitch}
              onChange={(v) => updateField('pitch', v)}
              style={{ flex: 1, margin: '0 4px' }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)', width: 30, textAlign: 'right' }}>
              {state.pitch.toFixed(1)}x
            </span>
          </div>

          {/* 试听 */}
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <Button
              size="small"
              icon={<CustomerServiceOutlined />}
              onClick={handleTest}
              loading={testing}
              style={{ fontSize: 11, flex: 1 }}
            >
              试听
            </Button>
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={() => stopTts()}
              style={{ fontSize: 11 }}
            >
              停止
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default VoiceSettings;
