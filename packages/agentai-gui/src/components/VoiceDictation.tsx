/**
 * VoiceDictation — 语音听写面板
 * -------------------------------------------------
 * 持续监听麦克风 → 实时转文字 → AI 整理后插入文档
 *
 * 工作流:
 *   1. 浏览器 Web Speech API 连续听写 (continuous + interim)
 *   2. 实时显示识别文字 (灰色=中间结果, 白色=最终结果)
 *   3. 检测到停顿 (1.5s 无新词) → 自动发给 AI 整理
 *   4. AI 整理后插入文档, 同时保留原始转写备查
 *
 * 依赖:
 *   - voice.ts (startSpeechRecognition)
 *   - /v1/chat (AI 整理)
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Tag, Tooltip, Alert } from 'antd';
import {
  AudioOutlined, AudioMutedOutlined, RobotOutlined,
  ClearOutlined, LoadingOutlined, CloseOutlined,
} from '@ant-design/icons';
import {
  startSpeechRecognition,
  isSpeechRecognitionSupported,
} from '../services/voice';
import { GATEWAY_HTTP } from '../services/config';

// ===== 停顿检测参数 =====
const PAUSE_MS = 1500; // 1.5s 无新词判定为停顿
const MAX_CHARS_BEFORE_SEND = 500; // 累计这么多字自动发送

// ===== AI 整理 prompt =====
const ORGANIZE_PROMPT = `你是一个听写整理助手。
请将以下语音转写内容整理成通顺的文字：
1. 修复口语化表达, 去掉"嗯、啊、这个、那个"等填充词
2. 添加标点符号, 合理分段
3. 保持原意, 不要添加未提及的内容
4. 输出纯文本, 不要 markdown 格式

语音内容:
`;

interface TranscriptionSegment {
  id: string;
  text: string;
  final: boolean;
  ts: number;
}

interface VoiceDictationProps {
  /** 写作模型名 (zhipu/agentai) */
  model: string;
  /** 整理完成回调: 返回 AI 整理后的文本 */
  onOrganized: (text: string, rawText: string) => void;
  /** 当前文档内容 (用于追加上下文) */
  context?: string;
}

export const VoiceDictation: React.FC<VoiceDictationProps> = ({
  model,
  onOrganized,
  context,
}) => {
  const [listening, setListening] = useState(false);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [organizing, setOrganizing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pauseTimerRef = useRef<number | null>(null);
  const lastWordTimeRef = useRef<number>(Date.now());
  const segmentsRef = useRef<TranscriptionSegment[]>([]);
  const interimRef = useRef('');
  const stopFnRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const supported = isSpeechRecognitionSupported();

  // ===== 自动发送整理 (停顿检测) =====
  const sendForOrganize = useCallback(() => {
    const segs = segmentsRef.current;
    const finalTexts = segs.filter(s => s.final).map(s => s.text).join('');
    const interim = interimRef.current;
    const all = (finalTexts + ' ' + interim).trim();

    if (all.length < 3) return;

    setOrganizing(true);
    setInterimText('');
    interimRef.current = '';

    const backendModel = model === 'zhipu' ? 'zhipu' : 'agentai';
    const ctxSuffix = context ? `\n\n当前文档上下文:\n${context.slice(-300)}` : '';
    const fullPrompt = ORGANIZE_PROMPT + all + '\n\n请直接输出整理后的文字。' + ctxSuffix;

    fetch(GATEWAY_HTTP + '/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullPrompt, stream: false, model: backendModel }),
    })
      .then(r => r.json())
      .then(json => {
        const organized = (json.content || '').trim();
        if (organized) {
          onOrganized(organized, all);
        }
        setOrganizing(false);
      })
      .catch(() => {
        setOrganizing(false);
      });

    // 清空已发的分段
    segmentsRef.current = [];
    setSegments([]);
  }, [model, onOrganized, context]);

  // ===== 重置停顿定时器 =====
  const resetPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);

    const elapsed = Date.now() - lastWordTimeRef.current;
    // 如果有足够长的静音, 直接发
    if (elapsed >= PAUSE_MS && segmentsRef.current.length > 0) {
      sendForOrganize();
    }

    pauseTimerRef.current = window.setTimeout(() => {
      const segs = segmentsRef.current;
      const hasContent = segs.some(s => s.final && s.text.trim().length > 0);
      if (hasContent) {
        sendForOrganize();
      }
    }, PAUSE_MS);
  }, [sendForOrganize]);

  // ===== 开始听写 =====
  const startListening = useCallback(() => {
    if (!supported) {
      setError('浏览器不支持语音识别。请使用 Chrome/Edge。');
      return;
    }
    setError(null);
    setListening(true);
    segmentsRef.current = [];
    setSegments([]);
    setInterimText('');
    interimRef.current = '';
    lastWordTimeRef.current = Date.now();

    const stopFn = startSpeechRecognition(
      (result) => {
        lastWordTimeRef.current = Date.now();

        if (result.final) {
          const newSeg: TranscriptionSegment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            text: result.text,
            final: true,
            ts: Date.now(),
          };
          segmentsRef.current = [...segmentsRef.current, newSeg];
          setSegments(segmentsRef.current);
          setInterimText('');
          interimRef.current = '';

          // 检查累计字数, 超了就自动发
          const totalLen = segmentsRef.current
            .filter(s => s.final)
            .reduce((acc, s) => acc + s.text.length, 0);
          if (totalLen >= MAX_CHARS_BEFORE_SEND) {
            sendForOrganize();
          }
        } else {
          setInterimText(result.text);
          interimRef.current = result.text;
        }
        resetPauseTimer();
      },
      (err) => {
        console.warn('[VoiceDictation]', err);
        setError(err);
        setListening(false);
      },
      { continuous: true, interim: true, lang: 'zh-CN' },
    );

    stopFnRef.current = stopFn;
  }, [supported, resetPauseTimer, sendForOrganize]);

  // ===== 停止听写 =====
  const stopListening = useCallback(() => {
    if (stopFnRef.current) {
      stopFnRef.current();
      stopFnRef.current = null;
    }
    // 发送最后的积累
    if (segmentsRef.current.length > 0) {
      sendForOrganize();
    }
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    setListening(false);
  }, [sendForOrganize]);

  // ===== 切换 =====
  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [listening, startListening, stopListening]);

  // ===== 清理 =====
  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (stopFnRef.current) {
        stopFnRef.current();
        stopFnRef.current = null;
      }
    };
  }, []);

  // ===== 自动滚动到底部 =====
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [segments, interimText]);

  if (!supported) return null;

  if (!expanded) {
    return (
      <Tooltip title={listening ? '点击展开听写面板' : '语音听写: 持续监听麦克风 → AI 整理'}>
        <Button
          size="small"
          type={listening ? 'primary' : 'default'}
          icon={listening ? <AudioOutlined style={{ color: '#ff4d4f' }} /> : <AudioMutedOutlined />}
          onClick={() => setExpanded(true)}
          style={{
            animation: listening ? 'pulse 1.2s ease-out infinite' : undefined,
            borderColor: listening ? '#ff4d4f' : undefined,
          }}
        >
          {listening ? '听写中' : '听写'}
          {organizing && <LoadingOutlined style={{ marginLeft: 4 }} />}
        </Button>
      </Tooltip>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      background: '#1a1a1a',
      borderTop: '2px solid #4F46E5',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '40vh',
    }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid #2a2a2a',
        background: '#141414',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd' }}>
          🎤 语音听写
        </span>
        <Tag
          color={listening ? 'red' : 'default'}
          style={{ fontSize: 10, margin: 0 }}
        >
          {listening ? '● 录音中' : '已暂停'}
        </Tag>
        {organizing && (
          <Tag color="processing" style={{ fontSize: 10, margin: 0 }}>
            <LoadingOutlined /> AI 整理中
          </Tag>
        )}

        <div style={{ flex: 1 }} />

        {/* 操作按钮 */}
        <Button
          size="small"
          type={listening ? 'primary' : 'default'}
          danger={listening}
          icon={listening ? <AudioMutedOutlined /> : <AudioOutlined />}
          onClick={toggleListening}
        >
          {listening ? '停止' : '开始'}
        </Button>
        <Tooltip title="手动发送整理">
          <Button
            size="small"
            icon={<RobotOutlined />}
            onClick={sendForOrganize}
            disabled={segments.length === 0 && !interimText}
            loading={organizing}
          >
            整理
          </Button>
        </Tooltip>
        <Tooltip title="清空">
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={() => { segmentsRef.current = []; setSegments([]); setInterimText(''); interimRef.current = ''; }}
            disabled={segments.length === 0 && !interimText}
          />
        </Tooltip>
        <Tooltip title="关闭">
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => { stopListening(); setExpanded(false); }}
            style={{ color: '#888' }}
          />
        </Tooltip>
      </div>

      {/* 转写内容 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 12px',
          minHeight: 60,
          maxHeight: 200,
        }}
      >
        {segments.length === 0 && !interimText && (
          <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 16 }}>
            {listening ? '🎤 正在监听, 请说话...' : '点击"开始"按钮开始语音听写'}
          </div>
        )}

        {/* 最终结果 */}
        {segments.map(seg => (
          <span key={seg.id} style={{ color: '#ddd', fontSize: 14, lineHeight: 1.6 }}>
            {seg.text}
          </span>
        ))}

        {/* 中间结果 */}
        {interimText && (
          <span style={{ color: '#888', fontSize: 14, lineHeight: 1.6, fontStyle: 'italic' }}>
            {interimText}
          </span>
        )}

        {/* 整理动画 */}
        {organizing && (
          <span style={{ color: '#4F46E5', fontSize: 12, marginLeft: 8 }}>
            <LoadingOutlined /> AI 整理中...
          </span>
        )}

        {/* 录入光标 */}
        {listening && !organizing && (
          <span style={{
            display: 'inline-block',
            width: 2, height: 16,
            background: '#4F46E5',
            marginLeft: 2,
            verticalAlign: 'middle',
            animation: 'blink 0.8s step-end infinite',
          }} />
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ fontSize: 11, padding: '2px 12px', margin: 0 }}
          banner
        />
      )}

      {/* 底部提示 */}
      <div style={{
        padding: '2px 12px 4px',
        color: '#555', fontSize: 10,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>说话后 1.5s 停顿自动送 AI 整理</span>
        <span>{segments.filter(s => s.final).length} 段 · {segments.reduce((a, s) => a + s.text.length, 0) + interimText.length} 字</span>
      </div>
    </div>
  );
};
