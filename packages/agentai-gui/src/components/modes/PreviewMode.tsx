/**
 * PreviewMode — 预览模式子组件
 * ----------------------------------------------------
 * 根据文件类型自动选择合适的预览器：
 *   - 图片 (png/jpg/gif/svg/webp...) → ImagePreview（缩放/旋转/下载）
 *   - PDF                        → PdfPreview（翻页/缩放/搜索）
 *   - 视频 (mp4/webm/mov...)     → VideoPreview（播放控制）
 *   - 音频 (mp3/wav/flac...)     → AudioPreview（播放器）
 *   - Markdown                   → MarkdownPreview（渲染预览）
 *   - 其他文本                   → TextPreview（纯文本只读）
 *
 * Phase 4 会进一步完善各预览器的功能和样式。
 * 当前版本提供基础可用的预览体验。
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Button, Tooltip, Slider, Tag } from 'antd';
import {
  ZoomInOutlined, ZoomOutOutlined, DownloadOutlined,
  RotateLeftOutlined, RotateRightOutlined, ExpandOutlined,
  LeftOutlined, RightOutlined, SoundOutlined,
  FileTextOutlined, CheckSquareOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getPreviewType, type PreviewType, type FileNode } from '../../types/workspace';
import { gatewayFallback } from '../../services/GatewayFallback';
import { Markdown as MdComponent } from '../Markdown';

// ═══════════════════════════════════════
// 子预览器组件
// ═══════════════════════════════════════

/** 图片预览器 */
const ImagePreview: React.FC<{ src: string; fileName: string }> = ({ src, fileName }) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const handleZoomIn = () => setZoom(z => Math.min(5, z + 0.25));
  const handleZoomOut = () => setZoom(z => Math.max(0.1, z - 0.25));
  const handleRotateLeft = () => setRotation(r => r - 90);
  const handleRotateRight = () => setRotation(r => r + 90);
  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = fileName;
    a.click();
  };
  const handleReset = () => { setZoom(1); setRotation(0); };

  return (
    <div className="preview-image" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* 工具栏 */}
      <div className="preview-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '8px 16px',
        background: 'rgba(30,30,35,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <Tooltip title="缩小"><Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} /></Tooltip>
        <div style={{ width: 80, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary,#aaa)' }}>
          {Math.round(zoom * 100)}%
        </div>
        <Tooltip title="放大"><Button type="text" size="small" icon={<ZoomInOutlined />} onClick={handleZoomIn} /></Tooltip>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        <Tooltip title="左旋转"><Button type="text" size="small" icon={<RotateLeftOutlined />} onClick={handleRotateLeft} /></Tooltip>
        <Tooltip title="右旋转"><Button type="text" size="small" icon={<RotateRightOutlined />} onClick={handleRotateRight} /></Tooltip>
        <Tooltip title="重置"><Button type="text" size="small" icon={<ExpandOutlined />} onClick={handleReset} /></Tooltip>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        <Tooltip title="下载"><Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleDownload} /></Tooltip>
      </div>

      {/* 缩放滑块 */}
      <div style={{ padding: '4px 24px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Slider
          min={0.1}
          max={5}
          step={0.1}
          value={zoom}
          onChange={setZoom}
          tooltip={{ formatter: v => `${Math.round((v || 0) * 100)}%` }}
          style={{ flex: 1 }}
        />
      </div>

      {/* 图片内容区 */}
      <div className="preview-image-container" style={{
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: zoom > 1 ? 'grab' : 'default',
        padding: 20,
      }}>
        <img
          src={src}
          alt={fileName}
          draggable={false}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transition: 'transform 0.2s ease',
            maxHeight: '100%',
            maxWidth: zoom > 1 ? 'none' : '100%',
            objectFit: 'contain',
            userSelect: 'none',
            boxShadow: zoom > 1 ? '0 8px 40px rgba(0,0,0,0.5)' : 'none',
          }}
        />
      </div>
    </div>
  );
};

/** PDF 预览器（基础版：使用 iframe 或 object 标签嵌入 PDF.js） */
const PdfPreview: React.FC<{ src: string; fileName: string }> = ({ src, fileName }) => {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);

  // 尝试使用 PDF.js 渲染；如果不可用则回退到 iframe/object
  const pdfUrl = useMemo(() => {
    // 如果是本地路径，通过 Gateway 代理
    if (src.startsWith('/') || /^[A-Z]:/.test(src)) {
      return `/api/file-proxy?path=${encodeURIComponent(src)}`;
    }
    return src;
  }, [src]);

  return (
    <div className="preview-pdf" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* 工具栏 */}
      <div className="preview-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '8px 16px',
        background: 'rgba(30,30,35,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <Button
          size="small"
          icon={<LeftOutlined />}
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage(p => p - 1)}
        />
        <span style={{ fontSize: 12, color: 'var(--text-secondary,#aaa)', minWidth: 80, textAlign: 'center' }}>
          第 {currentPage} 页 / 共 {numPages || '?'} 页
        </span>
        <Button
          size="small"
          icon={<RightOutlined />}
          disabled={numPages > 0 && currentPage >= numPages}
          onClick={() => setCurrentPage(p => p + 1)}
        />
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        <Tooltip title="缩小"><Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={() => setScale(s => Math.max(0.5, s - 0.2))} /></Tooltip>
        <span style={{ fontSize: 12, color: 'var(--text-secondary,#aaa)' }}>{Math.round(scale * 100)}%</span>
        <Tooltip title="放大"><Button type="text" size="small" icon={<ZoomInOutlined />} onClick={() => setScale(s => Math.min(3, s + 0.2))} /></Tooltip>
        <Tooltip title="下载"><Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => {
          const a = document.createElement('a');
          a.href = pdfUrl;
          a.download = fileName;
          a.click();
        }} /></Tooltip>
      </div>

      {/* PDF 内容区 */}
      <div className="preview-pdf-container" style={{
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        background: '#525659',
        padding: 20,
      }}>
        {/* Phase 4 可替换为 react-pdf 组件 */}
        <object
          data={pdfUrl}
          type="application/pdf"
          style={{
            width: `${794 * scale}px`, // A4 宽度 * 缩放
            height: `${1123 * scale}px`, // A4 高度 * 缩放
            border: 'none',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{
            padding: 60,
            textAlign: 'center',
            color: '#ccc',
            fontSize: 14,
          }}>
            <p>无法在浏览器中直接预览 PDF</p>
            <a href={pdfUrl} download={fileName} style={{ color: 'var(--accent,#f97316)' }}>
              点击下载 {fileName}
            </a>
          </div>
        </object>
      </div>
    </div>
  );
};

/** 视频预览器 */
const VideoPreview: React.FC<{ src: string; fileName: string }> = ({ src, fileName }) => {
  const videoUrl = useMemo(() => {
    if (src.startsWith('/') || /^[A-Z]:/.test(src)) {
      return `/api/file-proxy?path=${encodeURIComponent(src)}`;
    }
    return src;
  }, [src]);

  return (
    <div className="preview-video" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      background: '#000',
      gap: 12,
    }}>
      <video
        controls
        width="100%"
        style={{ maxHeight: '100%' }}
        preload="metadata"
      >
        <source src={videoUrl} />
        您的浏览器不支持视频播放。{' '}
        <a href={videoUrl} download={fileName} style={{ color: 'var(--accent,#f97316)' }}>下载</a>
      </video>
    </div>
  );
};

/** 音频预览器 */
const AudioPreview: React.FC<{ src: string; fileName: string }> = ({ src, fileName }) => {
  const audioUrl = useMemo(() => {
    if (src.startsWith('/') || /^[A-Z]:/.test(src)) {
      return `/api/file-proxy?path=${encodeURIComponent(src)}`;
    }
    return src;
  }, [src]);

  return (
    <div className="preview-audio" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      gap: 24,
    }}>
      <SoundOutlined style={{ fontSize: 64, color: 'var(--text-tertiary,#555)' }} />
      <audio controls preload="metadata" style={{ width: 'min(400px, 80%)' }}>
        <source src={audioUrl} />
        您的浏览器不支持音频播放
      </audio>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary,#666)' }}>{fileName}</span>
    </div>
  );
};

/** Markdown 预览器（复用现有 Markdown 组件） */
const MarkdownPreview: React.FC<{ content: string; filePath: string }> = React.memo(({ content }) => {
  return (
    <div className="preview-markdown" style={{
      width: '100%',
      height: '100%',
      overflow: 'auto',
      padding: '24px 40px',
      background: 'var(--bg-primary,#111)',
    }}>
      <MdComponent content={content} />
    </div>
  );
});

/** HTML 预览器（使用 iframe 渲染） */
const HtmlPreview: React.FC<{ src: string; fileName: string }> = ({ src, fileName }) => {
  const htmlUrl = useMemo(() => {
    if (src.startsWith('/') || /^[A-Z]:/.test(src)) {
      return `/api/file-proxy?path=${encodeURIComponent(src)}`;
    }
    return src;
  }, [src]);

  const handleOpenInNewTab = () => {
    window.open(htmlUrl, '_blank');
  };

  return (
    <div className="preview-html" style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* 工具栏 */}
      <div className="preview-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 16px',
        background: 'rgba(30,30,35,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary,#aaa)' }}>
          🌐 HTML 预览
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" onClick={handleOpenInNewTab}>
            在新标签页打开
          </Button>
          <Button 
            type="primary" 
            size="small" 
            icon={<DownloadOutlined />}
            onClick={() => {
              const a = document.createElement('a');
              a.href = htmlUrl;
              a.download = fileName;
              a.click();
            }}
          >
            下载
          </Button>
        </div>
      </div>

      {/* HTML 内容区 */}
      <div className="preview-html-container" style={{
        flex: 1,
        overflow: 'auto',
        background: '#fff',
      }}>
        <iframe
          src={htmlUrl}
          title={fileName}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </div>
  );
};

/** 纯文本预览器（只读） */
const TextPreview: React.FC<{ content: string; filePath: string }> = ({ content, filePath }) => (
  <pre className="preview-text" style={{
    width: '100%',
    height: '100%',
    overflow: 'auto',
    margin: 0,
    padding: '20px 28px',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.7,
    color: 'var(--text-primary,#ccc)',
    background: 'var(--bg-primary,#111)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    tabSize: 2,
  }}>
    {content || `(空文件: ${filePath})`}
  </pre>
);

// ═══════════════════════════════════════
// PreviewMode 主组件
// ═══════════════════════════════════════

/** 预览模式主组件 */
export const PreviewMode: React.FC = () => {
  const { currentFile } = useWorkspaceStore();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载文件内容
  const loadContent = useCallback(async (file: FileNode) => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = gatewayFallback.url || 'http://127.0.0.1:18789';
      const resp = await fetch(`${baseUrl}/v1/files/read?path=${encodeURIComponent(file.path)}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setContent(data.content || data || '');
    } catch (e: any) {
      setError(e.message || '加载失败');
      setContent('');
    } finally {
      setLoading(false);
    }
  }, []);

  // 当文件变化时重新加载
  React.useEffect(() => {
    if (currentFile?.path) {
      loadContent(currentFile);
    }
  }, [currentFile?.path]);

  // 无文件
  if (!currentFile) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 16, color: 'var(--text-tertiary,#666)',
      }}>
        <FileTextOutlined style={{ fontSize: 48, opacity: 0.3 }} />
        <p>没有选择要预览的文件</p>
        <Button type="link" onClick={() => {
          // 切换回编辑器模式
          useWorkspaceStore.getState().setMode('editor');
        }}>
          返回编辑器
        </Button>
      </div>
    );
  }

  // 加载中
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-tertiary,#666)',
      }}>
        正在加载预览...
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 12,
      }}>
        <span style={{ fontSize: 32 }}>⚠️</span>
        <p style={{ color: 'var(--text-secondary,#999)' }}>预览失败: {error}</p>
        <Button size="small" onClick={() => loadContent(currentFile)}>重试</Button>
      </div>
    );
  }

  // 根据类型分发到对应预览器
  const previewType = getPreviewType(currentFile);
  const fileSrc = currentFile.path;

  switch (previewType) {
    case 'image':
      return <ImagePreview src={fileSrc} fileName={currentFile.name} />;
    case 'pdf':
      return <PdfPreview src={fileSrc} fileName={currentFile.name} />;
    case 'video':
      return <VideoPreview src={fileSrc} fileName={currentFile.name} />;
    case 'audio':
      return <AudioPreview src={fileSrc} fileName={currentFile.name} />;
    case 'markdown':
      return <MarkdownPreview content={content} filePath={fileSrc} />;
    case 'html':
      return <HtmlPreview src={fileSrc} fileName={currentFile.name} />;
    case 'text':
    default:
      return <TextPreview content={content} filePath={fileSrc} />;
  }
};
