/**
 * PrescriptionCard — 中医处方卡片组件
 * 
 * 功能:
 * 1. 从 AI 回复中自动识别处方格式 (📋 中医处方单)
 * 2. 渲染为结构化卡片 (诊断/治则/方名/组成/煎服法/医嘱)
 * 3. 一键复制 (纯文本 + Markdown)
 * 4. 一键打印 (浏览器 print API, 带样式)
 */

import React, { useState, useMemo } from 'react';
import {
  CopyOutlined, PrinterOutlined, CheckOutlined,
  MedicineBoxOutlined, FileTextOutlined,
} from '@ant-design/icons';

// 解析 AI 回复中的处方内容
interface ParsedPrescription {
  diagnosis: string;       // 诊断/证型
  treatment: string;        // 治则
  formulaName: string;      // 方名
  source?: string;          // 出处
  ingredients: Array<{      // 组成
    role: string;           // 君/臣/佐/使
    name: string;
    dose: string;
    effect?: string;
  }>;
  decoction: string;        // 煎服法
  advice: string;           // 医嘱
  disclaimer: string;       // 免责声明
  rawText: string;          // 原始文本
}

// 正则解析处方
function parsePrescription(text: string): ParsedPrescription | null {
  // 检测是否包含处方标记
  if (!text.includes('📋') && !text.includes('中医处方') && !text.includes('【方名】')) return null;

  const prescription: ParsedPrescription = {
    diagnosis: '',
    treatment: '',
    formulaName: '',
    source: '',
    ingredients: [],
    decoction: '',
    advice: '',
    disclaimer: '',
    rawText: text,
  };

  // 提取诊断
  const diagMatch = text.match(/【诊断】(.+?)(?=\n|【|$)/s);
  if (diagMatch) prescription.diagnosis = diagMatch[1].trim();

  // 提取治则
  const treatMatch = text.match(/【治则】(.+?)(?=\n|【|$)/s);
  if (treatMatch) prescription.treatment = treatMatch[1].trim();

  // 提取方名和出处
  const formulaMatch = text.match(/【方名】(.+?)(?:\s*\(出自(.+?)\))?(?=\n|【|$)/s);
  if (formulaMatch) {
    prescription.formulaName = formulaMatch[1].trim();
    if (formulaMatch[2]) prescription.source = formulaMatch[2].trim();
  }

  // 提取药材组成 (支持多种格式)
  const ingredientPatterns = [
    /(?:君药|臣药|佐药|使药)\s*[—:-]\s*(\S+)\s*(\d+[gmg份])\s*[—:-]\s*(.+)/g,
    /\*\s*(君|臣|佐|使)药\s*[—:-]\s*(\S+)\s+(\d+[gmg份])\s*[—:-]\s*(.+)/g,
    /^\s*(\S+)\s+(\d+[gmg份])\s*[—:-]\s*(.+)$/gm,
  ];

  for (const pattern of ingredientPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const roleMap: Record<string, string> = { '君': '君药', '臣': '臣药', '佐': '佐药', '使': '使药' };
      prescription.ingredients.push({
        role: match[1] ? (roleMap[match[1]] || match[1]) : '成分',
        name: match[2] || match[1] || '',
        dose: match[3] || match[2] || '',
        effect: match[4]?.trim(),
      });
    }
  }

  // 如果正则没匹配到，尝试简单提取
  if (prescription.ingredients.length === 0) {
    const simpleMatch = text.match(/【组成】([\s\S]*?)(?=【|$)/);
    if (simpleMatch) {
      const lines = simpleMatch[1].split('\n').filter(l => l.trim());
      for (const line of lines) {
        const m = line.match(/(\S+)\s*(\d+[gmg份])/);
        if (m) {
          prescription.ingredients.push({ role: '', name: m[1], dose: m[2] });
        }
      }
    }
  }

  // 提取煎服法
  const decoctMatch = text.match(/【煎服法】([\s\S]*?)(?=【|$)/);
  if (decoctMatch) prescription.decoction = decoctMatch[1].trim();

  // 提取医嘱
  const adviceMatch = text.match(/【医嘱】([\s\S]*?)(?=⚠️|【|$)/);
  if (adviceMatch) prescription.advice = adviceMatch[1].trim();

  // 提取免责声明
  const discMatch = text.match(/⚠️(.+?)(?:$)/s);
  if (discMatch) prescription.disclaimer = discMatch[1].trim();

  // 至少要有诊断或方名才算有效处方
  if (!prescription.diagnosis && !prescription.formulaName) return null;

  return prescription;
}

// 角色颜色映射
const ROLE_COLORS: Record<string, string> = {
  '君药': '#e74c3c',
  '臣药': '#f39c12',
  '佐药': '#3498db',
  '使药': '#27ae60',
  '成分': '#95a5a6',
};

export default function PrescriptionCard({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const rx = useMemo(() => parsePrescription(content), [content]);

  if (!rx) return null;

  const handleCopy = async () => {
    try {
      // 复制纯文本版本
      const plainText = formatPlainText(rx);
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // fallback: 传统复制
      const textarea = document.createElement('textarea');
      textarea.value = formatPlainText(rx);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=600,height=800');
    if (!printWindow) return;

    printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>中医处方 - ${rx.formulaName || '处方单'}</title>
<style>
  @media print {
    body { padding: 20px; font-family: "SimSun", "STSong", serif; }
    .no-print { display: none !important; }
  }
  body { 
    font-family: -apple-system, "Microsoft YaHei", sans-serif; 
    padding: 24px; max-width: 520px; margin: 0 auto;
    color: #1a1a1a; background: #fff;
  }
  .rx-header { 
    border-bottom: 2px solid #1abc9c; padding-bottom: 12px; margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  .rx-title { font-size: 20px; font-weight: bold; color: #1abc9c; }
  .rx-section { margin-bottom: 14px; }
  .rx-label { 
    font-weight: 600; color: #555; background: #f0f9f6; 
    padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 4px;
    font-size: 13px;
  }
  .rx-value { padding-left: 12px; line-height: 1.6; white-space: pre-wrap; }
  .ingredient-row { 
    display: flex; align-items: baseline; gap: 8px; padding: 3px 0;
    border-bottom: 1px dashed #eee;
  }
  .role-badge { 
    font-size: 11px; padding: 1px 6px; border-radius: 10px; color: #fff; font-weight: 600;
  }
  .herb-name { font-weight: 600; min-width: 70px; }
  .herb-dose { color: #e74c3c; font-weight: 500; min-width: 45px; }
  .herb-effect { color: #666; font-size: 13px; }
  .disclaimer { 
    margin-top: 16px; padding: 10px; background: #fef9e7; 
    border: 1px solid #f0c36d; border-radius: 6px; font-size: 12px; color: #856404;
  }
  .rx-footer { 
    margin-top: 20px; text-align: center; font-size: 11px; color: #999;
    border-top: 1px solid #eee; padding-top: 10px;
  }
</style>
</head>
<body>
<div class="rx-header">
  <span style="font-size: 24px;">🏥</span>
  <span class="rx-title">${rx.formulaName || '中医处方单'}</span>
</div>

${rx.diagnosis ? `<div class="rx-section"><span class="rx-label">【诊断】</span><div class="rx-value">${escapeHtml(rx.diagnosis)}</div></div>` : ''}
${rx.treatment ? `<div class="rx-section"><span class="rx-label">【治则】</span><div class="rx-value">${escapeHtml(rx.treatment)}</div></div>` : ''}
${rx.formulaName ? `<div class="rx-section"><span class="rx-label">【方名】</span><div class="rx-value">${escapeHtml(rx.formulaName)} ${rx.source ? `(出自《${escapeHtml(rx.source)}》)` : ''}</div></div>` : ''}

${rx.ingredients.length > 0 ? `
<div class="rx-section">
<span class="rx-label">【组成】</span>
<div class="rx-value">
${rx.ingredients.map(ing => `
<div class="ingredient-row">
  <span class="role-badge" style="background:${ROLE_COLORS[ing.role] || ROLE_COLORS['成分']}">${ing.role}</span>
  <span class="herb-name">${escapeHtml(ing.name)}</span>
  <span class="herb-dose">${escapeHtml(ing.dose)}</span>
  ${ing.effect ? `<span class="herb-effect">— ${escapeHtml(ing.effect)}</span>` : ''}
</div>
`).join('')}
</div>
</div>` : ''}

${rx.decoction ? `<div class="rx-section"><span class="rx-label">【煎服法】</span><div class="rx-value" style="white-space:pre-wrap">${escapeHtml(rx.decoction)}</div></div>` : ''}
${rx.advice ? `<div class="rx-section"><span class="rx-label">【医嘱】</span><div class="rx-value" style="white-space:pre-wrap">${escapeHtml(rx.advice)}</div></div>` : ''}

<div class="disclaimer">
  ⚠️ ${escapeHtml(rx.disclaimer || '此辨证开方仅供参考和学习交流，不替代线下医师面诊。如症状严重或持续不缓解，请及时就医。')}
</div>

<div class="rx-footer">
  AgentAI 中医问诊系统 · ${new Date().toLocaleDateString('zh-CN')} · 仅供学习参考
</div>

<script>window.onload = () => { window.print(); }</script>
</body>
</html>`);
    printWindow.document.close();
  };

  return (
    <div style={{
      marginTop: 12, borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--panel)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      {/* 卡片头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: 'linear-gradient(135deg, #1abc9c15, #16a08515)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MedicineBoxOutlined style={{ color: '#1abc9c', fontSize: 18 }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1abc9c' }}>
            {rx.formulaName || '中医处方单'}
          </span>
          {rx.source && (
            <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', padding: '1px 6px', borderRadius: 8 }}>
              《{rx.source}》
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleCopy}
            className="icon-btn-sm"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 11,
              background: copied ? '#27ae60' : 'var(--bg)', color: copied ? '#fff' : 'var(--fg-2)',
              border: `1px solid ${copied ? '#27ae60' : 'var(--border)'}`, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            title={copied ? '已复制!' : '复制处方'}
          >
            {copied ? <CheckOutlined /> : <CopyOutlined />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            onClick={handlePrint}
            className="icon-btn-sm"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 11,
              background: 'var(--bg)', color: 'var(--fg-2)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
            title="打印处方"
          >
            <PrinterOutlined /> 打印
          </button>
        </div>
      </div>

      {/* 卡片内容 */}
      <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.7 }}>

        {/* 诊断 + 治则 */}
        {(rx.diagnosis || rx.treatment) && (
          <div style={{ display: 'grid', gridTemplateColumns: rx.diagnosis && rx.treatment ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
            {rx.diagnosis && (
              <div>
                <div style={{ fontWeight: 600, color: '#e74c3c', fontSize: 11, marginBottom: 2 }}>【诊断】</div>
                <div style={{ color: 'var(--fg)' }}>{rx.diagnosis}</div>
              </div>
            )}
            {rx.treatment && (
              <div>
                <div style={{ fontWeight: 600, color: '#f39c12', fontSize: 11, marginBottom: 2 }}>【治则】</div>
                <div style={{ color: 'var(--fg)' }}>{rx.treatment}</div>
              </div>
            )}
          </div>
        )}

        {/* 药材组成 */}
        {rx.ingredients.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, color: '#1abc9c', fontSize: 11, marginBottom: 6 }}>【组成】</div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 4,
            }}>
              {rx.ingredients.map((ing, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px', borderRadius: 4,
                  background: `${ROLE_COLORS[ing.role] || ROLE_COLORS['成分']}08`,
                  borderLeft: `3px solid ${ROLE_COLORS[ing.role] || ROLE_COLORS['成分']}`,
                }}>
                  <span style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 8,
                    color: '#fff', background: ROLE_COLORS[ing.role] || ROLE_COLORS['成分'],
                    fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{ing.role}</span>
                  <span style={{ fontWeight: 600, minWidth: 50 }}>{ing.name}</span>
                  <span style={{ color: '#e74c3c', fontWeight: 500, fontFamily: 'monospace' }}>{ing.dose}</span>
                  {ing.effect && (
                    <span style={{ color: 'var(--muted)', fontSize: 11, fontStyle: 'italic' }}>
                      — {ing.effect.length > 20 ? ing.effect.slice(0, 18) + '...' : ing.effect}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 煎服法 */}
        {rx.decoction && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, color: '#3498db', fontSize: 11, marginBottom: 2 }}>【煎服法】</div>
            <div style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{rx.decoction}</div>
          </div>
        )}

        {/* 医嘱 */}
        {rx.advice && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, color: '#27ae60', fontSize: 11, marginBottom: 2 }}>【医嘱】</div>
            <div style={{ color: 'var(--fg-2)', whiteSpace: 'pre-wrap', fontSize: 12 }}>{rx.advice}</div>
          </div>
        )}

        {/* 免责声明 */}
        <div style={{
          padding: '8px 10px', background: '#fef9e7', border: '1px solid #f0c36d',
          borderRadius: 4, fontSize: 11, color: '#856404', lineHeight: 1.5,
        }}>
          ⚠️ {rx.disclaimer || '此辨证开方仅供参考和学习交流，不替代线下医师面诊。如症状严重或持续不缓解，请及时就医。'}
        </div>
      </div>
    </div>
  );
}

// 格式化为纯文本（用于复制）
function formatPlainText(rx: ParsedPrescription): string {
  const lines: string[] = [
    '╔═══════════════════════════════════════╗',
    '║         中 医 处 方 单              ║',
    '╚═══════════════════════════════════════╝',
    '',
  ];
  if (rx.diagnosis) lines.push(`【诊断】  ${rx.diagnosis}`);
  if (rx.treatment) lines.push(`【治则】  ${rx.treatment}`);
  if (rx.formulaName) lines.push(`【方名】  ${rx.formulaName}${rx.source ? ` (出自《${rx.source}》)` : ''}`);
  if (rx.ingredients.length > 0) {
    lines.push('', '【组成】');
    for (const ing of rx.ingredients) {
      lines.push(`  ${ing.role.padEnd(4, '　')} ${ing.name.padEnd(8, '　')} ${ing.dose}${ing.effect ? `  — ${ing.effect}` : ''}`);
    }
  }
  if (rx.decoction) lines.push('', `【煎服法】\n${rx.decoction}`);
  if (rx.advice) lines.push('', `【医嘱】\n${rx.advice}`);
  lines.push('', '─'.repeat(35));
  lines.push(`⚠️ ${rx.disclaimer || '此辨证开方仅供参考，不替代线下医师面诊。'}`);
  lines.push(`生成时间: ${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 导出解析函数供外部使用
export { parsePrescription };
export type { ParsedPrescription };
