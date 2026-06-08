/**
 * FileUpload - 通用文件上传 (Chat 用)
 * 拖拽 + 按钮 + 多文件 + 进度
 */
import React, { useState, useRef, useCallback } from 'react';
import { Upload, message, Button, Space, Image, Tag, Tooltip } from 'antd';
import { InboxOutlined, PaperClipOutlined, PictureOutlined, FileTextOutlined, DeleteOutlined } from '@ant-design/icons';

const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

export interface UploadedFile {
  filename: string;
  originalName: string;
  url: string;
  size: number;
  mimetype: string;
}

export const uploadFile = async (file: File): Promise<UploadedFile | null> => {
  const form = new FormData();
  form.append('file', file);
  try {
    const r = await fetch(`${httpUrl}/v1/upload`, {
      method: 'POST',
      body: form,
    });
    const data = await r.json();
    if (data.error) {
      message.error(`上传失败: ${data.error}`);
      return null;
    }
    message.success(`已上传 ${data.originalName}`);
    return data;
  } catch (e: any) {
    message.error('上传失败: ' + e.message);
    return null;
  }
};

interface FileUploadProps {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  maxSize?: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({ files, onChange, maxSize = 50 * 1024 * 1024 }) => {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i]!;
      if (f.size > maxSize) {
        message.error(`${f.name} 太大 (上限 ${(maxSize / 1024 / 1024).toFixed(0)}MB)`);
        continue;
      }
      const uploaded = await uploadFile(f);
      if (uploaded) {
        onChange([...files, uploaded]);
      }
    }
  }, [files, onChange, maxSize]);

  const remove = (filename: string) => {
    onChange(files.filter(f => f.filename !== filename));
  };

  const isImage = (m: string) => m.startsWith('image/');

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      style={{ display: 'inline-block' }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
      <Space wrap>
        {files.map(f => (
          <div key={f.filename} style={{ position: 'relative', display: 'inline-block' }}>
            {isImage(f.mimetype) ? (
              <div style={{ width: 60, height: 60, borderRadius: 4, overflow: 'hidden', border: '1px solid #333' }}>
                <img src={f.url} alt={f.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <Tag icon={<FileTextOutlined />} color="blue" style={{ padding: '4px 8px' }}>
                {f.originalName.length > 12 ? f.originalName.slice(0, 10) + '…' : f.originalName}
              </Tag>
            )}
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => remove(f.filename)}
              style={{ position: 'absolute', top: -8, right: -8, background: '#000', border: '1px solid #333' }}
            />
          </div>
        ))}
        <Tooltip title="点击或拖拽上传 (图片/文件, ≤50MB)">
          <Button
            size="small"
            icon={<PaperClipOutlined />}
            onClick={() => inputRef.current?.click()}
            style={{ background: dragging ? '#4F46E5' : undefined, borderColor: dragging ? '#4F46E5' : undefined }}
          >
            📎 上传{files.length > 0 ? ` (${files.length})` : ''}
          </Button>
        </Tooltip>
      </Space>
    </div>
  );
};
