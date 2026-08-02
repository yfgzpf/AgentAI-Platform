/**
 * WritePage — 写作面板
 * 引擎: GLM-4.7-Flash (智谱免费) / Agnes 2.0 Flash 可选
 * 特色: 模板预设 · AI 动作模式 · 选中替换 · 自动保存 · 导出 md/html/pdf/docx
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, message as msg, Tooltip, Select, Tag, Alert, Switch } from 'antd';
import { SaveOutlined, FileTextOutlined, ExportOutlined, ClearOutlined, SendOutlined, RobotOutlined } from '@ant-design/icons';
import { Markdown } from './Markdown';
import { VoiceDictation } from './VoiceDictation';
import { GATEWAY_HTTP } from '../services/config';

// ===== AI 动作模式 =====
type AiAction = '续写' | '润色' | '扩写' | '缩写' | '翻译中文' | '翻译英文' | '口语化' | '总结';

const AI_ACTIONS: { key: AiAction; prompt: (sel: string) => string }[] = [
  { key: '续写',   prompt: s => `请根据以下内容续写一段文字, 保持风格一致:\n\n${s || '(空)'}` },
  { key: '润色',   prompt: s => `请润色以下文字, 修复语法错误, 优化表达但不改变原意:\n\n${s}` },
  { key: '扩写',   prompt: s => `请将以下文字扩写到原来的 2-3 倍, 补充细节:\n\n${s}` },
  { key: '缩写',   prompt: s => `请将以下文字缩写到一半长度, 保留核心信息:\n\n${s}` },
  { key: '翻译中文', prompt: s => `请将以下文字翻译成中文:\n\n${s}` },
  { key: '翻译英文', prompt: s => `请将以下文字翻译成英文:\n\n${s}` },
  { key: '口语化', prompt: s => `请将以下文字改写成口语化风格, 像日常对话:\n\n${s}` },
  { key: '总结',   prompt: s => `请总结以下文字的要点 (200字内):\n\n${s}` },
];

// ===== 写作模板 =====
const TEMPLATES: { label: string; prompt: string }[] = [
  { label: '通用文章', prompt: '请写一篇关于 "{{topic}}" 的文章, 包含引言、主体和结论, 语气专业但易懂。' },
  { label: '工作报告', prompt: '请写一份关于 "{{topic}}" 的工作报告, 包含: 背景、进展、成果、下一步计划。语气正式。' },
  { label: '商务邮件', prompt: '请写一封关于 "{{topic}}" 的商务邮件, 语气礼貌专业, 结构清晰。' },
  { label: '会议纪要', prompt: '请为 "{{topic}}" 会议写一份纪要, 包含: 参会人、议题、讨论要点、行动项。' },
  { label: '产品说明', prompt: '请写一份关于 "{{topic}}" 的产品说明文档, 包含: 概述、功能、用法、FAQ。' },
  { label: '个人笔记', prompt: '请整理关于 "{{topic}}" 的个人笔记, 要点清晰, 附带个人见解。语气轻松。' },
];

// ===== 模型选项 =====
const WRITE_MODELS = [
  { value: 'zhipu', label: 'GLM-4.7 Flash (免费)', desc: '智谱免费, 同 ZHIPU_API_KEY' },
  { value: 'agentai', label: 'Agnes 2.0 Flash', desc: '需 AGENTAI_API_KEY' },
];

export const WritePage: React.FC = () => {
  const [content, setContent] = useState(() => localStorage.getItem('agentai-write-draft') || '');
  const [preview, setPreview] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [writeModel, setWriteModel] = useState(() => localStorage.getItem('agentai-write-model') || 'zhipu');
  const [title, setTitle] = useState(() => localStorage.getItem('agentai-write-title') || '未命名文档');
  const [aiAction, setAiAction] = useState<AiAction>('续写');
  const [replaceMode, setReplaceMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  // ===== 语音听写回调: 整理后的文本插入文档 =====
  const handleVoiceOrganized = useCallback((organized: string, rawText: string) => {
    const ta = textareaRef.current;
    const selStart = ta?.selectionStart;
    const selEnd = ta?.selectionEnd;

    if (replaceMode && selStart !== undefined && selEnd !== undefined && selStart !== selEnd) {
      // 替换选中
      setContent(prev => prev.slice(0, selStart) + `\n\n${organized}\n\n` + prev.slice(selEnd));
    } else {
      // 追加到末尾
      setContent(prev => prev + `\n\n${organized}\n\n`);
    }
  }, [replaceMode]);

  // ===== 自动保存 (debounce 3s) =====
  const autoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem('agentai-write-draft', content);
      localStorage.setItem('agentai-write-title', title);
      localStorage.setItem('agentai-write-model', writeModel);
    }, 3000);
  }, [content, title, writeModel]);

  useEffect(() => { autoSave(); return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }; }, [autoSave]);

  // ===== 手动保存 =====
  const handleSave = () => {
    localStorage.setItem('agentai-write-draft', content);
    localStorage.setItem('agentai-write-title', title);
    msg.success('✅ 已保存');
  };

  // ===== 字数统计 =====
  const wordCount = content.replace(/\s/g, '').length;
  const readTime = Math.max(1, Math.round(wordCount / 300));

  // ===== 模板注入 =====
  const applyTemplate = (tpl: string) => {
    const topic = title.replace(/^未命名文档$/, '') || '待定主题';
    const prompt = tpl.replace(/\{\{topic\}\}/g, topic);
    setAiPrompt(prompt);
    msg.info('模板已填入 AI 输入框, 点"生成"');
  };

  // ===== AI 辅助 =====
  const aiComplete = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    try {
      // 如果是替换模式且有选中文本, 用选中文本替换
      const ta = textareaRef.current;
      const selStart = ta?.selectionStart ?? content.length;
      const selEnd = ta?.selectionEnd ?? content.length;
      const selectedText = content.slice(selStart, selEnd);

      // 构建 prompt: 如果是标准动作 + 有选中, 按动作处理
      const actionDef = AI_ACTIONS.find(a => a.key === aiAction);
      let finalPrompt = aiPrompt;
      if (actionDef && selectedText) {
        finalPrompt = actionDef.prompt(selectedText);
      } else if (actionDef && !selectedText) {
        finalPrompt = actionDef.prompt(content.slice(-500));
      }
      // 追加当前文档末尾作为上下文
      if (!actionDef) {
        finalPrompt = `${finalPrompt}\n\n当前文档:\n${content.slice(-800)}`;
      }

      const backendModel = writeModel === 'zhipu' ? 'zhipu' : 'agentai';
      const resp = await fetch(GATEWAY_HTTP + '/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: finalPrompt, stream: false, model: backendModel }),
      });
      const json = await resp.json();
      const aiText = (json.content || '').trim();
      if (!aiText) { msg.warning('AI 返回为空'); return; }

      if (replaceMode && selectedText) {
        // 替换选中文本
        setContent(prev => prev.slice(0, selStart) + aiText + prev.slice(selEnd));
        msg.success(`✅ ${aiAction} 完成 (替换选中)`);
      } else {
        // 追加到末尾
        setContent(prev => prev + '\n\n' + aiText);
        msg.success(`✅ ${aiAction || '生成'} 完成`);
      }
    } catch (e: any) { msg.error(String(e)); }
    finally { setAiBusy(false); setAiPrompt(''); }
  };

  // ===== 导出 =====
  const exportDoc = (format: 'md' | 'html' | 'pdf' | 'docx') => {
    if (format === 'docx') {
      // 调用后端 docx skill
      fetch(GATEWAY_HTTP + '/v1/skills/docx/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, markdown: content }),
      }).then(r => r.json()).then(data => {
        if (data.fileUrl) {
          const a = document.createElement('a');
          a.href = data.fileUrl;
          a.download = `${title.replace(/\.\w+$/, '')}.docx`;
          a.click();
          msg.success('✅ docx 已导出');
        } else {
          msg.warning('docx skill 不可用, 请使用 md/pdf 导出');
        }
      }).catch(() => msg.warning('docx 导出失败, 请使用 md/pdf'));
      return;
    }

    if (format === 'pdf') {
      const win = window.open('', '_blank');
      if (!win) { msg.error('浏览器阻止了弹出窗口'); return; }
      win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
        <style>body{font-family:'Segoe UI',sans-serif;padding:40px;line-height:1.8;max-width:800px;margin:auto;color:#333}
        h1,h2,h3{color:#1a1a1a;margin-top:24px}code{background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:.9em}
        pre{background:#f5f5f5;padding:16px;border-radius:8px;overflow-x:auto}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#666}
        @media print{body{padding:0;margin:0}}</style></head><body><div id="content"></div>
        <script>document.getElementById('content').innerHTML = ${JSON.stringify(
          '<p>' + content.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/^- (.+)$/gm, '<li>$1</li>').split('\n\n').join('</p><p>')
        )};</script></body></html>`);
      win.document.close();
      setTimeout(() => { win.print(); }, 500);
      return;
    }
    const blob = new Blob(
      format === 'md' ? [content] : [`<html><body>${content}</body></html>`],
      { type: format === 'md' ? 'text/markdown' : 'text/html' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.replace(/\.\w+$/, '') + '.' + format;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', background: 'var(--bg-2)', flexWrap: 'wrap' }}>
        <input value={title} onChange={e => { setTitle(e.target.value); }}
          style={{ background: 'transparent', border: 'none', color: 'var(--border)', fontSize: 14, fontWeight: 600, outline: 'none', flex: 1, minWidth: 120 }} />

        {/* 模型选择器 */}
        <Select
          size="small"
          value={writeModel}
          onChange={(v) => setWriteModel(v)}
          style={{ width: 190 }}
          options={WRITE_MODELS.map(m => ({ value: m.value, label: m.label }))}
        />

        {/* 语音听写 */}
        <VoiceDictation
          model={writeModel}
          onOrganized={handleVoiceOrganized}
          context={content}
        />

        <div style={{ width: 1, height: 20, background: 'var(--card-hover)' }} />

        {/* 模板 */}
        <Select
          size="small"
          placeholder="📋 模板"
          style={{ width: 120 }}
          onChange={(v) => applyTemplate((v ?? '') as string)}
          options={TEMPLATES.map(t => ({ value: t.prompt, label: t.label }))}
          value={undefined}
        />

        <Button size="small" type={preview ? 'primary' : 'default'} onClick={() => setPreview(!preview)} style={{ fontSize: 11 }}>
          {preview ? '编辑' : '预览'}
        </Button>

        <div style={{ width: 1, height: 20, background: 'var(--card-hover)' }} />

        {/* 导出 */}
        <Tooltip title="导出 Markdown"><Button size="small" type="text" icon={<ExportOutlined />} onClick={() => exportDoc('md')} style={{ color: 'var(--muted)' }}>MD</Button></Tooltip>
        <Tooltip title="导出 PDF"><Button size="small" type="text" icon={<FileTextOutlined />} onClick={() => exportDoc('pdf')} style={{ color: 'var(--muted)' }}>PDF</Button></Tooltip>
        <Tooltip title="导出 Word (docx)"><Button size="small" type="text" icon={<FileTextOutlined />} onClick={() => exportDoc('docx')} style={{ color: 'var(--muted)' }}>DOCX</Button></Tooltip>
        <Tooltip title="保存"><Button size="small" type="text" icon={<SaveOutlined />} onClick={handleSave} style={{ color: 'var(--muted)' }} /></Tooltip>
        <Tooltip title="清空"><Button size="small" type="text" icon={<ClearOutlined />} onClick={() => { setContent(''); localStorage.removeItem('agentai-write-draft'); }} style={{ color: 'var(--muted)' }} /></Tooltip>
      </div>

      {/* 编辑器/预览 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!preview && (
          <textarea ref={textareaRef} value={content} onChange={e => setContent(e.target.value)}
            style={{ flex: 1, padding: 20, background: 'var(--card)', color: 'var(--border)', border: 'none', outline: 'none', fontSize: 14, lineHeight: 1.8, fontFamily: 'monospace', resize: 'none' }} />
        )}
        {preview && (
          <div style={{ flex: 1, padding: 20, overflow: 'auto', color: 'var(--border)', lineHeight: 1.8 }}>
            <Markdown content={content} />
          </div>
        )}
      </div>

      {/* 底栏: 字数统计 */}
      <div style={{ borderTop: '1px solid var(--panel-2)', background: 'var(--bg-2)' }}>
        {/* 字数 + 替换模式 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 12px', color: 'var(--muted)', fontSize: 11 }}>
          <span>{wordCount} 字</span>
          <span>{readTime} min 阅读</span>
          <div style={{ flex: 1 }} />
          <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Switch size="small" checked={replaceMode} onChange={setReplaceMode} />
            <span style={{ color: replaceMode ? 'var(--accent)' : 'var(--muted)' }}>选中替换</span>
          </label>
          {replaceMode && <span style={{ color: 'var(--muted)' }}>选中文字后输出将替换选中区域</span>}
        </div>

        {/* 动作标签 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', flexWrap: 'wrap' }}>
          {AI_ACTIONS.slice(0, 4).map(a => (
            <Tag key={a.key} color={aiAction === a.key ? 'volcano' : 'default'}
              style={{ cursor: 'pointer', margin: 0 }}
              onClick={() => setAiAction(a.key)}>
              {a.key}
            </Tag>
          ))}
          <Select
            size="small"
            value={aiAction}
            onChange={(v) => setAiAction(v as AiAction)}
            style={{ width: 100 }}
            options={AI_ACTIONS.slice(4).map(a => ({ value: a.key, label: a.key }))}
          />
          <div style={{ width: 1, height: 20, background: 'var(--card-hover)' }} />
        </div>

        {/* 输入 */}
        <div style={{ display: 'flex', gap: 6, padding: '4px 12px 6px' }}>
          <Input.TextArea
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            placeholder={replaceMode ? '选中文字后点生成 → 替换选中' : `AI ${aiAction}: 输入指令或直接点生成...`}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); aiComplete(); } }}
            autoSize={{ minRows: 1, maxRows: 3 }}
            style={{ flex: 1, background: 'var(--bg)', borderColor: '#262626', color: 'var(--border)', fontSize: 12 }}
          />
          <Button icon={<RobotOutlined />} onClick={aiComplete} loading={aiBusy} type="primary" ghost style={{ alignSelf: 'flex-end' }}>
            生成
          </Button>
        </div>

        {writeModel === 'zhipu' && (
          <Alert type="info" message="GLM-4.7-Flash 免费模型, 同 ZHIPU_API_KEY。智谱文本/生图/视频共用同一 Key。" style={{ fontSize: 10, padding: '3px 12px', margin: 0 }} banner />
        )}
      </div>
    </div>
  );
};
