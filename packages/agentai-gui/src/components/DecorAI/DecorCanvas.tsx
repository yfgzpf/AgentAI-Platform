/**
 * DecorCanvas — 基于 ReactFlow 的可拖拽画布 v2
 *
 * 核心能力:
 *   - 图片节点 (ImageNode): 双击进入编辑 / 单击选中 / 右键菜单 / 连接端口
 *   - 连线 (Edge): 创建时弹出选择框 → 选择功能类型及参数
 *   - 删除: 选中节点按 Delete 或右键菜单删除
 *   - 去AI化图标: 使用行业通用图标
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Spin, Modal, Select, Input, Space, Button, message, Dropdown } from 'antd';
import {
  PictureOutlined, DeleteOutlined, ExpandOutlined, CopyOutlined,
  NodeIndexOutlined, // 连线图标
  EditOutlined,      // 编辑图标
  BgColorsOutlined,  // 风格图标
  MergeCellsOutlined,// 融合图标
  EyeOutlined,       // 预览图标
  MoreOutlined,      // 更多操作
} from '@ant-design/icons';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  Handle,
  Position,
  useReactFlow,
  MarkerType,
  useKeyPress,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { CanvasImage } from '../DecorAI/types';
import { DECOR_STYLES } from './styles';

// ==================== 节点操作回调类型 ====================
interface NodeActions {
  onDelete: (id: string) => void;
  onPreview: (url: string) => void;
  onCopy: (url: string) => void;
  onEdit: (id: string) => void;
}

// ==================== 图片节点 ====================

interface ImageNodeData extends Record<string, unknown> {
  imageUrl: string;
  prompt: string;
  mode: CanvasImage['mode'];
  model: string;
  size: string;
  timestamp: number;
  selected?: boolean;
  actions: NodeActions;
}

function ImageNode({ data, id }: { data: ImageNodeData; id: string }) {
  const [hovered, setHovered] = useState(false);

  // 右键菜单项
  const menuItems = [
    {
      key: 'preview',
      icon: <EyeOutlined />,
      label: '预览大图',
      onClick: () => data.actions.onPreview(data.imageUrl),
    },
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '遮罩改图',
      onClick: () => data.actions.onEdit(id),
    },
    {
      key: 'copy',
      icon: <CopyOutlined />,
      label: '复制图片链接',
      onClick: () => data.actions.onCopy(data.imageUrl),
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除节点',
      danger: true,
      onClick: () => data.actions.onDelete(id),
    },
  ];

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <div
        className="decor-image-node"
        style={{
          borderRadius: 8,
          overflow: 'hidden',
          border: data.selected ? '3px solid #6366f1' : '2px solid var(--border)',
          boxShadow: data.selected ? '0 0 20px rgba(99,102,241,0.4)' : 'none',
          transition: 'all 0.15s ease',
          background: 'var(--card)',
          cursor: 'pointer',
          minWidth: 180,
          maxWidth: 320,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 输出端口 (右侧) */}
        <Handle
          type="source"
          position={Position.Right}
          id="output-edit"
          style={{ background: '#6366f1', width: 10, height: 10, right: -5, top: '30%' }}
          title="改图"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="output-style"
          style={{ background: '#8b5cf6', width: 10, height: 10, right: -5, top: '60%' }}
          title="风格迁移"
        />

        {/* 输入端口 (左侧) */}
        <Handle
          type="target"
          position={Position.Left}
          id="input-ref"
          style={{ background: '#22c55e', width: 10, height: 10, left: -5, top: '50%' }}
          title="接收参考"
        />

        {/* 图片 */}
        <img
          src={data.imageUrl}
          alt={data.prompt.slice(0, 40)}
          style={{
            width: '100%',
            height: 'auto',
            maxHeight: 280,
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none',
          }}
          draggable={false}
        />

        {/* 信息栏 */}
        <div style={{
          padding: '6px 8px',
          background: 'var(--panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
        }}>
          <span style={{
            fontSize: 11,
            color: 'var(--muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {data.mode === 'edit' ? '✏️ 改图' : data.mode === 'style_transfer' ? '🎨 迁移' : '🖼️ 效果'}
          </span>
          <span style={{ fontSize: 9, color: 'var(--accent)', opacity: 0.7 }}>
            {data.model.slice(0, 12)}
          </span>
        </div>

        {/* Hover 操作浮层 */}
        {hovered && (
          <div style={{
            position: 'absolute',
            top: 6,
            right: 6,
            display: 'flex',
            gap: 4,
            zIndex: 10,
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 4,
            padding: 4,
          }}>
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined style={{ color: '#fff' }} />}
              onClick={(e) => {
                e.stopPropagation();
                data.actions.onPreview(data.imageUrl);
              }}
            />
            <Button
              size="small"
              type="text"
              icon={<EditOutlined style={{ color: '#fff' }} />}
              onClick={(e) => {
                e.stopPropagation();
                data.actions.onEdit(id);
              }}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined style={{ color: '#ff4d4f' }} />}
              onClick={(e) => {
                e.stopPropagation();
                data.actions.onDelete(id);
              }}
            />
          </div>
        )}
      </div>
    </Dropdown>
  );
}

// ==================== 主画布组件 ====================

interface DecorCanvasProps {
  images: CanvasImage[];
  selectedImageId: string | null;
  onImageSelect: (id: string | null) => void;
  onImageGenerate: (prompt: string, mode: CanvasImage['mode'], sourceUrl?: string) => void;
  onImageDelete?: (id: string) => void;
  onImageEdit?: (id: string) => void;
  busy?: boolean;
}

export function DecorCanvas({
  images,
  selectedImageId,
  onImageSelect,
  onImageGenerate,
  onImageDelete,
  onImageEdit,
  busy,
}: DecorCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edgeModalVisible, setEdgeModalVisible] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [edgeConfig, setEdgeConfig] = useState({
    type: 'edit' as 'edit' | 'style_transfer' | 'reference',
    prompt: '',
    style: '',
  });

  const reactFlowInstance = useReactFlow();

  // Delete 键删除选中节点
  const deletePressed = useKeyPress('Delete');
  
  React.useEffect(() => {
    if (deletePressed && selectedImageId) {
      handleDeleteNode(selectedImageId);
    }
  }, [deletePressed, selectedImageId]);

  // 节点操作方法
  const handleDeleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    onImageDelete?.(id);
    if (selectedImageId === id) {
      onImageSelect(null);
    }
    message.success('已删除节点');
  }, [onImageDelete, selectedImageId, onImageSelect]);

  const handlePreview = useCallback((url: string) => {
    Modal.info({
      title: '图片预览',
      content: <img src={url} alt="preview" style={{ width: '100%' }} />,
      width: 800,
      icon: null,
      footer: null,
    });
  }, []);

  const handleCopy = useCallback((url: string) => {
    navigator.clipboard.writeText(url);
    message.success('图片链接已复制');
  }, []);

  const handleEdit = useCallback((id: string) => {
    onImageSelect(id);
    onImageEdit?.(id);
  }, [onImageSelect, onImageEdit]);

  // 将 canvasImages 同步为 ReactFlow nodes
  useMemo(() => {
    const actions: NodeActions = {
      onDelete: handleDeleteNode,
      onPreview: handlePreview,
      onCopy: handleCopy,
      onEdit: handleEdit,
    };

    const flowNodes: Node[] = images.map((img, index) => ({
      id: img.id,
      type: 'imageNode' as const,
      position: { x: 80 + (index % 3) * 340, y: 80 + Math.floor(index / 3) * 340 },
      data: {
        ...img,
        // 确保图片 URL 是完整的（处理相对路径）
        imageUrl: img.url?.startsWith('http') 
          ? img.url 
          : img.url?.startsWith('/') 
            ? `${window.location.origin}${img.url}` 
            : img.url,
        selected: img.id === selectedImageId,
        actions,
      },
    }));

    setNodes(flowNodes);
  }, [images, selectedImageId, handleDeleteNode, handlePreview, handleCopy, handleEdit]);

  // 单击选中 / 双击编辑
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'imageNode') {
      onImageSelect(node.id);
    }
  }, [onImageSelect]);

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type === 'imageNode') {
      handleEdit(node.id);
    }
  }, [handleEdit]);

  // 连线开始时弹出选择框
  const onConnectStart = useCallback((event: React.MouseEvent, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
    // 记录起始信息，但不立即创建 edge
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) {
      message.warning('不能连接到自己');
      return false;
    }

    // 保存连接信息，弹出选择框
    setPendingConnection(connection);
    setEdgeConfig({
      type: 'edit',
      prompt: '',
      style: '',
    });
    setEdgeModalVisible(true);
    return false; // 暂不创建 edge
  }, []);

  // 确认创建连线
  const handleCreateEdge = () => {
    if (!pendingConnection) return;

    const { source, target, sourceHandle } = pendingConnection;
    const type = edgeConfig.type;
    
    const newEdge: Edge = {
      id: `edge-${Date.now()}`,
      source: source!,
      target: target!,
      sourceHandle: sourceHandle || 'output-edit',
      targetHandle: 'input-ref',
      type: 'default',
      animated: true,
      label: getEdgeLabelByType(type),
      style: {
        stroke: getEdgeColorByType(type),
        strokeWidth: 2,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: getEdgeColorByType(type) },
      data: { config: edgeConfig }, // 保存配置
    };

    setEdges((eds) => addEdge(newEdge, eds));
    setEdgeModalVisible(false);
    setPendingConnection(null);

    // 触发对应的生成操作
    const sourceImg = images.find((i) => i.id === source);
    if (sourceImg) {
      const prompt = edgeConfig.prompt || getEdgeLabelByType(type);
      const mode: CanvasImage['mode'] = type === 'reference' ? 'img2img' : type;
      onImageGenerate(prompt, mode, sourceImg.url);
    }
  };

  // 连线点击 → 重新编辑配置
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    // 可以弹出编辑框修改连线配置
    message.info(`连线类型: ${edge.label}`);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => setNodes((nds) => applyNodeChanges(changes, nds))}
        onEdgesChange={(changes) => setEdges((eds) => applyEdgeChanges(changes, eds))}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={{ imageNode: ImageNode }}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: 'var(--border)', strokeWidth: 1.5 },
        }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null} // 我们自己处理 Delete 键
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          nodeColor={(n) => (n.selected ? '#6366f1' : 'var(--card)')}
          maskColor="rgba(0,0,0,0.15)"
          style={{ background: 'var(--panel)' }}
          position="bottom-right"
        />
      </ReactFlow>

      {/* 空状态覆盖层 */}
      {images.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <PictureOutlined style={{ fontSize: 48, opacity: 0.2 }} />
          <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 14 }}>
            画布为空 — 在右侧生成效果图后拖拽至此
          </div>
          <div style={{ marginTop: 8, color: 'var(--muted-2)', fontSize: 12 }}>
            提示：从右侧图片拖拽到画布，或点击"添加到画布"按钮
          </div>
        </div>
      )}

      {/* 加载遮罩 */}
      {busy && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            borderRadius: 8,
          }}
        >
          <Spin size="large" tip="生成中..." />
        </div>
      )}

      {/* 连线配置弹窗 */}
      <Modal
        title={
          <Space>
            <NodeIndexOutlined style={{ color: '#6366f1' }} />
            选择连线功能
          </Space>
        }
        open={edgeModalVisible}
        onOk={handleCreateEdge}
        onCancel={() => {
          setEdgeModalVisible(false);
          setPendingConnection(null);
        }}
        okText="确认创建"
        cancelText="取消"
        width={480}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>功能类型</div>
            <Select
              value={edgeConfig.type}
              onChange={(val) => setEdgeConfig((c) => ({ ...c, type: val }))}
              style={{ width: '100%' }}
              options={[
                { value: 'edit', label: <Space><EditOutlined /> 改图编辑</Space>, desc: '基于原图进行局部修改' },
                { value: 'style_transfer', label: <Space><BgColorsOutlined /> 风格迁移</Space>, desc: '将图片转换为另一种风格' },
                { value: 'reference', label: <Space><MergeCellsOutlined /> 参考生成</Space>, desc: '以此图为参考生成新图' },
              ]}
            />
          </div>

          {edgeConfig.type === 'style_transfer' && (
            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>目标风格</div>
              <Select
                value={edgeConfig.style}
                onChange={(val) => {
                  setEdgeConfig((c) => ({ ...c, style: val }));
                  const style = DECOR_STYLES.find((s) => s.key === val);
                  if (style) {
                    setEdgeConfig((c) => ({ ...c, prompt: style.prompt }));
                  }
                }}
                style={{ width: '100%' }}
                placeholder="选择要迁移到的风格"
                options={DECOR_STYLES.map((s) => ({ value: s.key, label: `${s.icon} ${s.label}` }))}
              />
            </div>
          )}

          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              {edgeConfig.type === 'edit' ? '修改指令' : 
               edgeConfig.type === 'style_transfer' ? '风格描述 (可选)' : 
               '生成提示词'}
            </div>
            <Input.TextArea
              value={edgeConfig.prompt}
              onChange={(e) => setEdgeConfig((c) => ({ ...c, prompt: e.target.value }))}
              placeholder={
                edgeConfig.type === 'edit' 
                  ? '例如：把沙发换成深棕色皮质，背景墙改为大理石纹理'
                  : edgeConfig.type === 'style_transfer'
                  ? '可选：补充风格描述'
                  : '描述要生成的内容'
              }
              rows={3}
            />
          </div>

          <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, fontSize: 12, color: '#666' }}>
            <strong>说明：</strong>
            {edgeConfig.type === 'edit' && '改图编辑会保留原图大部分内容，仅根据指令修改指定区域'}
            {edgeConfig.type === 'style_transfer' && '风格迁移会将整张图片转换为选定的装修风格'}
            {edgeConfig.type === 'reference' && '参考生成会以此图为灵感，生成相似但不同的新图'}
          </div>
        </Space>
      </Modal>
    </div>
  );
}

// ==================== 工具函数 ====================

function getEdgeLabelByType(type: string): string {
  switch (type) {
    case 'edit': return '改图 ↘';
    case 'style_transfer': return '风格迁移 ↘';
    case 'reference': return '参考 ↘';
    default: return '生成 ↘';
  }
}

function getEdgeColorByType(type: string): string {
  switch (type) {
    case 'edit': return '#6366f1';
    case 'style_transfer': return '#8b5cf6';
    case 'reference': return '#22c55e';
    default: return '#999';
  }
}

export default DecorCanvas;
