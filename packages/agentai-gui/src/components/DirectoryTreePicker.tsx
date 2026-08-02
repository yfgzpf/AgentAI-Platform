/**
 * DirectoryTreePicker — 内置目录树选择器 (替代原生 webkitdirectory)
 * ================================================================
 *
 * 背景: 原生 <input type="file" webkitdirectory> 在 WebView 中行为不稳定,
 *       且只能选盘符不能展开子目录 (用户反馈).
 *       改用后端 API 驱动的目录树浏览器.
 *
 * 后端依赖:
 *   GET /v1/fs/drives    → { drives: ["C:\\",...], common: [...] }
 *   GET /v1/fs/list?dir= → { entries: [{name,path,type,size}] }
 *
 * v3.1 (2026-07-16) 新增
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Input, Spin, Button, Space, Typography, Tooltip } from 'antd';
import {
  FolderOutlined, FolderOpenOutlined, HddOutlined,
  HomeOutlined, CloseOutlined, CheckOutlined,
} from '@ant-design/icons';
import { gatewayFallback } from '../services/GatewayFallback';

const { Text } = Typography;
const API = () => gatewayFallback.url;

/* ============================================================ */
/*  树节点模型                                                  */
/* ============================================================ */
interface DirEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
}

/* ============================================================ */
/*  组件属性                                                    */
/* ============================================================ */
interface Props {
  /** 当前选中的路径 (用于高亮) */
  value?: string;
  /** 选择确认回调 */
  onSelect: (path: string) => void;
  /** 是否可见 */
  visible: boolean;
  /** 关闭 */
  onClose: () => void;
}

/* ============================================================ */
/*  DirectoryTreePicker                                         */
/* ============================================================ */
export const DirectoryTreePicker: React.FC<Props> = ({ value, onSelect, visible, onClose }) => {
  const [drives, setDrives] = useState<string[]>([]);
  const [common, setCommon] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [currentDir, setCurrentDir] = useState<string>('');
  // 历史栈 (用于 "上级目录" 后退)
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string>(value || '');

  // 打开时加载驱动器列表
  useEffect(() => {
    if (!visible) return;
    setCurrentDir('');
    setEntries([]);
    setHistory([]);
    setError(null);
    selectedRef.current = value || '';
    loadDrives();
  }, [visible]);

  /** 加载驱动器列表 */
  const loadDrives = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API()}/v1/fs/drives`);
      const data = await r.json();
      setDrives(data.drives || []);
      setCommon(data.common || []);
    } catch (e: any) {
      setError(`加载驱动器失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  /** 加载目录内容 */
  const loadDir = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API()}/v1/fs/list?dir=${encodeURIComponent(dir)}`);
      const data = await r.json();
      // 只显示目录
      const dirs = (data.entries || []).filter((e: DirEntry) => e.type === 'directory');
      setEntries(dirs);
      setCurrentDir(dir);
    } catch (e: any) {
      setError(`加载目录失败: ${e.message}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 点击驱动器 */
  const onDriveClick = (drive: string) => {
    setHistory([drive]); // 驱动器是根, 清空历史
    loadDir(drive);
  };

  /** 点击目录 (展开子目录) */
  const onDirClick = (entry: DirEntry) => {
    setHistory(h => [...h, currentDir]);
    loadDir(entry.path);
  };

  /** 返回上级目录 */
  const goUp = () => {
    if (history.length === 0) {
      // 回到驱动器列表
      setCurrentDir('');
      setEntries([]);
      return;
    }
    const prev = history[history.length - 1]!;
    setHistory(h => h.slice(0, -1));
    loadDir(prev);
  };

  /** 确认选择当前目录 */
  const confirmDir = () => {
    if (currentDir) {
      onSelect(currentDir);
      onClose();
    }
  };

  /** 获取目录名称 (用于显示面包屑) */
  const dirName = currentDir
    ? currentDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || currentDir
    : '';

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      title={
        <Space size={8}>
          <FolderOpenOutlined style={{ color: 'var(--accent)' }} />
          <span>选择工作目录</span>
        </Space>
      }
      footer={
        <Space>
          <Button size="small" onClick={onClose}>取消</Button>
          <Button
            size="small" type="primary"
            disabled={!currentDir}
            icon={<CheckOutlined />}
            onClick={confirmDir}
          >
            选择此目录
          </Button>
        </Space>
      }
      width={520}
      styles={{ body: { padding: '8px 12px', maxHeight: 420, overflow: 'auto' } }}
      destroyOnClose
    >
      {/* 面包屑 / 上级按钮 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', marginBottom: 6,
        background: 'var(--panel)', borderRadius: 6,
        border: '1px solid var(--border)',
        minHeight: 34,
      }}>
        {currentDir ? (
          <>
            <Tooltip title="返回上级">
              <Button
                size="small" type="text"
                icon={<FolderOpenOutlined />}
                onClick={goUp}
                style={{ color: 'var(--accent)' }}
              />
            </Tooltip>
            <Text ellipsis style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--fg-2)', flex: 1 }}>
              {currentDir}
            </Text>
            <span style={{
              fontSize: 9, color: 'var(--muted-2)', flexShrink: 0,
              padding: '0 6px', background: 'var(--success-soft)', borderRadius: 4,
            }}>
              {entries.length} 个子目录
            </span>
          </>
        ) : (
          <Text style={{ fontSize: 11, color: 'var(--muted-2)' }}>
            选择一个驱动器开始浏览
          </Text>
        )}
      </div>

      {/* 内容区 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin size="small" />
          <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 4 }}>加载中...</div>
        </div>
      ) : error ? (
        <div style={{ padding: 12, textAlign: 'center', color: 'var(--danger)', fontSize: 11 }}>
          {error}
          <Button size="small" onClick={loadDrives} style={{ marginLeft: 8 }}>重试</Button>
        </div>
      ) : currentDir ? (
        /* 目录条目列表 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {entries.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted-2)', fontSize: 11 }}>
              此目录下没有子目录
            </div>
          ) : (
            entries.map(entry => {
              const selected = currentDir === entry.path || value === entry.path;
              return (
                <div
                  key={entry.path}
                  onClick={() => onDirClick(entry)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 11,
                    color: selected ? 'var(--accent)' : 'var(--fg-2)',
                    background: selected ? 'var(--accent-soft)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <FolderOutlined style={{ color: 'var(--warning)', fontSize: 13, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--muted-2)', flexShrink: 0 }}>
                    ▶
                  </span>
                </div>
              );
            })
          )}
          {/* 当前选中提示 */}
          {currentDir && (
            <div style={{
              marginTop: 8, padding: '4px 8px',
              background: 'var(--success-soft)', borderRadius: 4,
              border: '1px dashed var(--success)',
              fontSize: 10, color: 'var(--muted)',
            }}>
              ✅ 当前目录: <Text code style={{ fontSize: 10 }}>{currentDir}</Text>
              <span style={{ marginLeft: 6, color: 'var(--accent)' }}>
                — 点击"选择此目录"确认
              </span>
            </div>
          )}
        </div>
      ) : (
        /* 驱动器 + 常用目录 */
        <div>
          {/* 常用目录 */}
          {common.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>
                <HomeOutlined style={{ marginRight: 4 }} />常用目录
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {common.map(dir => (
                  <div
                    key={dir}
                    onClick={() => onDriveClick(dir)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                      fontSize: 11, color: 'var(--fg-2)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--panel)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <FolderOpenOutlined style={{ color: 'var(--accent)', fontSize: 12 }} />
                    <span style={{ flex: 1 }}>{dir}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>▶</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 驱动器 */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 4 }}>
              <HddOutlined style={{ marginRight: 4 }} />驱动器
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {drives.map(drive => (
                <div
                  key={drive}
                  onClick={() => onDriveClick(drive)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 11, color: 'var(--fg-2)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <HddOutlined style={{ color: 'var(--violet)', fontSize: 12 }} />
                  <span>{drive}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>▶</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default DirectoryTreePicker;
