/**
 * PascalEditor — 3D 建筑编辑器组件
 * --------------------------------------------------
 * 集成 Pascal Editor MCP Server，提供 AI 驱动的建筑模型编辑能力
 * 
 * 功能:
 *   - 启动/停止 MCP Server
 *   - 显示当前建筑模型状态
 *   - 导出/导入建筑模型
 *   - 实时查看建筑元素
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, Space, Tag, Alert, Spin, Collapse, Descriptions, message } from 'antd';
import { 
  PlayCircleOutlined, 
  StopOutlined, 
  ExportOutlined, 
  ImportOutlined, 
  HomeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';

interface PascalStatus {
  running: boolean;
  port: number;
  workspace: string;
}

interface BuildingElement {
  id: string;
  type: 'wall' | 'door' | 'window' | 'roof' | 'floor' | 'room';
  position?: { x: number; y: number; z: number };
  dimensions?: { width: number; height: number; depth?: number };
}

interface BuildingModel {
  id: string;
  name: string;
  elements: BuildingElement[];
  metadata?: Record<string, any>;
}

export const PascalEditor: React.FC = () => {
  const [status, setStatus] = useState<PascalStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<BuildingModel | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // 获取状态
  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/gateway/pascal/status');
      if (resp.ok) {
        const data = await resp.json();
        setStatus(data);
      }
    } catch (e) {
      console.error('获取状态失败:', e);
    }
  }, []);

  // 获取当前模型
  const fetchCurrentModel = useCallback(async () => {
    if (!status?.running) return;
    try {
      const resp = await fetch('/api/gateway/pascal/model');
      if (resp.ok) {
        const data = await resp.json();
        setCurrentModel(data.model);
      }
    } catch (e) {
      console.error('获取模型失败:', e);
    }
  }, [status?.running]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.running) {
      fetchCurrentModel();
      const interval = setInterval(fetchCurrentModel, 3000);
      return () => clearInterval(interval);
    }
  }, [fetchCurrentModel, status?.running]);

  // 启动服务
  const handleStart = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/gateway/pascal/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 3100 }),
      });
      const data = await resp.json();
      if (data.success) {
        messageApi.success('MCP Server 已启动');
        await fetchStatus();
      } else {
        messageApi.error(data.message || '启动失败');
      }
    } catch (e: any) {
      messageApi.error(`启动失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 停止服务
  const handleStop = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/gateway/pascal/stop', {
        method: 'POST',
      });
      const data = await resp.json();
      if (data.success) {
        messageApi.success('MCP Server 已停止');
        setStatus(null);
        setCurrentModel(null);
      } else {
        messageApi.error(data.message || '停止失败');
      }
    } catch (e: any) {
      messageApi.error(`停止失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 导出模型
  const handleExport = async () => {
    if (!status?.running) {
      messageApi.warning('请先启动 MCP Server');
      return;
    }
    try {
      const resp = await fetch('/api/gateway/pascal/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'glb',
          outputPath: `building_${Date.now()}.glb`,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        messageApi.success(`模型已导出: ${data.filePath}`);
      } else {
        messageApi.error(data.error || '导出失败');
      }
    } catch (e: any) {
      messageApi.error(`导出失败: ${e.message}`);
    }
  };

  // 统计元素
  const elementStats = currentModel?.elements.reduce((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {contextHolder}
      
      <Card
        title={
          <Space>
            <HomeOutlined style={{ color: 'var(--accent)' }} />
            <span>3D 建筑编辑器</span>
            <Tag color={status?.running ? 'success' : 'default'}>
              {status?.running ? '运行中' : '未启动'}
            </Tag>
          </Space>
        }
        extra={
          <Space>
            {!status?.running ? (
              <Button 
                type="primary" 
                icon={<PlayCircleOutlined />} 
                onClick={handleStart}
                loading={loading}
              >
                启动服务
              </Button>
            ) : (
              <Button 
                danger 
                icon={<StopOutlined />} 
                onClick={handleStop}
                loading={loading}
              >
                停止服务
              </Button>
            )}
          </Space>
        }
      >
        <Alert
          message="Pascal Editor 集成"
          description="通过 AI 自然语言控制 3D 建筑模型。在对话中告诉 AI：'帮我设计一个两室一厅的房子'，AI 会自动创建墙体、放置门窗、生成屋顶。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {status?.running && (
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="服务状态">
              <Tag color="success" icon={<CheckCircleOutlined />}>运行中</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="端口">
              {status.port}
            </Descriptions.Item>
            <Descriptions.Item label="工作目录" span={2}>
              {status.workspace}
            </Descriptions.Item>
          </Descriptions>
        )}

        {!status?.running && (
          <Alert
            message="服务未启动"
            description="点击'启动服务'按钮启动 Pascal Editor MCP Server，然后就可以在对话中使用建筑编辑功能了。"
            type="warning"
            showIcon
          />
        )}
      </Card>

      {status?.running && currentModel && (
        <Card 
          title="当前建筑模型" 
          style={{ marginTop: 16 }}
          extra={
            <Button 
              icon={<ExportOutlined />} 
              onClick={handleExport}
            >
              导出模型
            </Button>
          }
        >
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="模型 ID">
              {currentModel.id}
            </Descriptions.Item>
            <Descriptions.Item label="模型名称">
              {currentModel.name || '未命名'}
            </Descriptions.Item>
            <Descriptions.Item label="元素总数">
              {currentModel.elements.length} 个
            </Descriptions.Item>
            <Descriptions.Item label="元素统计">
              <Space wrap>
                {elementStats.wall && <Tag color="blue">墙体 {elementStats.wall}</Tag>}
                {elementStats.door && <Tag color="green">门 {elementStats.door}</Tag>}
                {elementStats.window && <Tag color="cyan">窗 {elementStats.window}</Tag>}
                {elementStats.roof && <Tag color="orange">屋顶 {elementStats.roof}</Tag>}
                {elementStats.floor && <Tag color="purple">楼层 {elementStats.floor}</Tag>}
              </Space>
            </Descriptions.Item>
          </Descriptions>

          <Collapse style={{ marginTop: 16 }} ghost>
            <Collapse.Panel header={`建筑元素详情 (${currentModel.elements.length})`} key="1">
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {currentModel.elements.map((el) => (
                  <Card 
                    key={el.id} 
                    size="small" 
                    style={{ marginBottom: 8 }}
                    title={
                      <Space>
                        <Tag color={
                          el.type === 'wall' ? 'blue' :
                          el.type === 'door' ? 'green' :
                          el.type === 'window' ? 'cyan' :
                          el.type === 'roof' ? 'orange' :
                          el.type === 'floor' ? 'purple' : 'default'
                        }>
                          {el.type}
                        </Tag>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{el.id}</span>
                      </Space>
                    }
                  >
                    {el.position && (
                      <div style={{ fontSize: 12 }}>
                        位置: ({el.position.x}, {el.position.y}, {el.position.z})
                      </div>
                    )}
                    {el.dimensions && (
                      <div style={{ fontSize: 12 }}>
                        尺寸: {el.dimensions.width} × {el.dimensions.height}
                        {el.dimensions.depth && ` × ${el.dimensions.depth}`}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </Collapse.Panel>
          </Collapse>
        </Card>
      )}

      {status?.running && !currentModel && (
        <Card style={{ marginTop: 16 }}>
          <Alert
            message="暂无建筑模型"
            description="在对话中告诉 AI 你想要设计什么样的建筑，AI 会自动创建模型。例如：'帮我设计一个 100 平米的三室一厅'"
            type="info"
            showIcon
          />
        </Card>
      )}

      <Card title="使用说明" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p><strong>1. 启动服务</strong></p>
          <p>点击"启动服务"按钮，启动 Pascal Editor MCP Server。</p>
          
          <p><strong>2. AI 对话</strong></p>
          <p>在对话界面中，告诉 AI 你想要设计的建筑：</p>
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            <li>"帮我设计一个两室一厅的房子"</li>
            <li>"创建一个 120 平米的别墅，带花园"</li>
            <li>"设计一个现代风格的办公室"</li>
          </ul>
          
          <p><strong>3. AI 自动操作</strong></p>
          <p>AI 会自动调用工具：</p>
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            <li>创建墙体 (pascal_create_wall)</li>
            <li>放置门窗 (pascal_place_opening)</li>
            <li>生成屋顶 (pascal_generate_roof)</li>
            <li>创建楼层 (pascal_create_floor)</li>
          </ul>
          
          <p><strong>4. 导出模型</strong></p>
          <p>设计完成后，点击"导出模型"按钮，导出为 GLB/OBJ/USDZ/IFC 格式，可用于：</p>
          <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
            <li>3D 打印</li>
            <li>AR/VR 展示</li>
            <li>BIM 软件 (Revit/ArchiCAD)</li>
            <li>游戏引擎 (Unity/Unreal)</li>
          </ul>
        </div>
      </Card>
    </div>
  );
};

export default PascalEditor;
