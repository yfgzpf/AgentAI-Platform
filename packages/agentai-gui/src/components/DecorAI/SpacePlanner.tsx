/**
 * SpacePlanner — 空间规划工具
 * 
 * 为设计师提供:
 *   - 户型图导入/绘制
 *   - 空间尺寸标注
 *   - 家具布局规划
 *   - 面积计算
 *   - 动线分析
 */

import React, { useState, useRef, useCallback } from 'react';
import { Card, Button, Input, Space, Tag, Tooltip, message, Row, Col, Slider, Select } from 'antd';
import { 
  PlusOutlined, DeleteOutlined, DragOutlined, 
  ExpandOutlined, CompressOutlined, SaveOutlined,
  UploadOutlined, DownloadOutlined, CopyOutlined,
} from '@ant-design/icons';

const { Option } = Select;

// ==================== 类型定义 ====================

interface Room {
  id: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'study' | 'dining';
  width: number; // 米
  length: number; // 米
  area: number;
  position: { x: number; y: number };
  rotation: number;
  color: string;
}

interface Furniture {
  id: string;
  name: string;
  type: string;
  width: number;
  length: number;
  roomId?: string;
  position?: { x: number; y: number };
  rotation: number;
}

interface FloorPlan {
  id: string;
  name: string;
  totalArea: number;
  rooms: Room[];
  furnitures: Furniture[];
  scale: number; // 像素/米
}

// ==================== 预设家具尺寸 ====================

const FURNITURE_TEMPLATES = [
  { type: 'sofa-3', name: '三人沙发', width: 2.2, length: 0.9 },
  { type: 'sofa-2', name: '双人沙发', width: 1.8, length: 0.9 },
  { type: 'sofa-l', name: 'L型沙发', width: 3.0, length: 1.8 },
  { type: 'coffee-table', name: '茶几', width: 1.2, length: 0.6 },
  { type: 'tv-stand', name: '电视柜', width: 2.0, length: 0.45 },
  { type: 'dining-table-4', name: '4人餐桌', width: 1.4, length: 0.8 },
  { type: 'dining-table-6', name: '6人餐桌', width: 1.8, length: 0.9 },
  { type: 'bed-1.5', name: '1.5米床', width: 1.5, length: 2.0 },
  { type: 'bed-1.8', name: '1.8米床', width: 1.8, length: 2.0 },
  { type: 'bed-2.0', name: '2.0米床', width: 2.0, length: 2.2 },
  { type: 'wardrobe', name: '衣柜', width: 1.8, length: 0.6 },
  { type: 'desk', name: '书桌', width: 1.2, length: 0.6 },
  { type: 'nightstand', name: '床头柜', width: 0.5, length: 0.4 },
];

const ROOM_COLORS: Record<string, string> = {
  living: '#E3F2FD',
  bedroom: '#F3E5F5',
  kitchen: '#FFF3E0',
  bathroom: '#E0F7FA',
  balcony: '#E8F5E9',
  study: '#FBE9E7',
  dining: '#FFF8E1',
};

// ==================== 组件 ====================

interface SpacePlannerProps {
  onPlanChange?: (plan: FloorPlan) => void;
  initialPlan?: FloorPlan;
}

export const SpacePlanner: React.FC<SpacePlannerProps> = ({ 
  onPlanChange,
  initialPlan,
}) => {
  const [plan, setPlan] = useState<FloorPlan>(initialPlan || {
    id: `plan-${Date.now()}`,
    name: '未命名户型',
    totalArea: 0,
    rooms: [],
    furnitures: [],
    scale: 50, // 1米 = 50像素
  });

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [scale, setScale] = useState(50);
  const canvasRef = useRef<HTMLDivElement>(null);

  // 计算总面积
  const calculateTotalArea = useCallback((rooms: Room[]) => {
    return rooms.reduce((sum, room) => sum + room.area, 0);
  }, []);

  // 添加房间
  const addRoom = (type: Room['type']) => {
    const roomNames: Record<string, string> = {
      living: '客厅',
      bedroom: '卧室',
      kitchen: '厨房',
      bathroom: '卫生间',
      balcony: '阳台',
      study: '书房',
      dining: '餐厅',
    };

    const newRoom: Room = {
      id: `room-${Date.now()}`,
      name: roomNames[type],
      type,
      width: type === 'bathroom' ? 2 : type === 'balcony' ? 1.5 : 4,
      length: type === 'bathroom' ? 3 : type === 'balcony' ? 4 : 5,
      area: 0,
      position: { x: 50 + plan.rooms.length * 20, y: 50 + plan.rooms.length * 20 },
      rotation: 0,
      color: ROOM_COLORS[type],
    };
    newRoom.area = newRoom.width * newRoom.length;

    const updatedRooms = [...plan.rooms, newRoom];
    const updatedPlan = {
      ...plan,
      rooms: updatedRooms,
      totalArea: calculateTotalArea(updatedRooms),
    };
    setPlan(updatedPlan);
    onPlanChange?.(updatedPlan);
    setSelectedRoomId(newRoom.id);
  };

  // 更新房间尺寸
  const updateRoomSize = (roomId: string, width: number, length: number) => {
    const updatedRooms = plan.rooms.map(room => {
      if (room.id === roomId) {
        return { ...room, width, length, area: width * length };
      }
      return room;
    });
    const updatedPlan = {
      ...plan,
      rooms: updatedRooms,
      totalArea: calculateTotalArea(updatedRooms),
    };
    setPlan(updatedPlan);
    onPlanChange?.(updatedPlan);
  };

  // 删除房间
  const deleteRoom = (roomId: string) => {
    const updatedRooms = plan.rooms.filter(r => r.id !== roomId);
    const updatedPlan = {
      ...plan,
      rooms: updatedRooms,
      totalArea: calculateTotalArea(updatedRooms),
      furnitures: plan.furnitures.filter(f => f.roomId !== roomId),
    };
    setPlan(updatedPlan);
    onPlanChange?.(updatedPlan);
    setSelectedRoomId(null);
  };

  // 添加家具
  const addFurniture = (template: typeof FURNITURE_TEMPLATES[0]) => {
    if (!selectedRoomId) {
      message.warning('请先选择一个房间');
      return;
    }

    const newFurniture: Furniture = {
      id: `fur-${Date.now()}`,
      name: template.name,
      type: template.type,
      width: template.width,
      length: template.length,
      roomId: selectedRoomId,
      rotation: 0,
    };

    const updatedPlan = {
      ...plan,
      furnitures: [...plan.furnitures, newFurniture],
    };
    setPlan(updatedPlan);
    onPlanChange?.(updatedPlan);
  };

  // 导出户型数据
  const exportPlan = () => {
    const dataStr = JSON.stringify(plan, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${plan.name}.json`;
    link.click();
    message.success('户型数据已导出');
  };

  const selectedRoom = plan.rooms.find(r => r.id === selectedRoomId);

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      {/* 左侧：画布区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Card 
          size="small" 
          title="户型规划"
          extra={
            <Space>
              <span style={{ fontSize: 12, color: '#666' }}>
                总面积: <strong>{plan.totalArea.toFixed(1)}</strong> ㎡
              </span>
              <Tooltip title="导出户型">
                <Button size="small" icon={<DownloadOutlined />} onClick={exportPlan} />
              </Tooltip>
            </Space>
          }
          style={{ flex: 1 }}
        >
          {/* 画布 */}
          <div
            ref={canvasRef}
            style={{
              width: '100%',
              height: 400,
              background: '#f5f5f5',
              position: 'relative',
              overflow: 'auto',
              border: '1px dashed #d9d9d9',
              borderRadius: 4,
            }}
          >
            {/* 网格背景 */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `
                  linear-gradient(to right, #e0e0e0 1px, transparent 1px),
                  linear-gradient(to bottom, #e0e0e0 1px, transparent 1px)
                `,
                backgroundSize: `${scale}px ${scale}px`,
              }}
            />

            {/* 房间 */}
            {plan.rooms.map(room => (
              <div
                key={room.id}
                onClick={() => setSelectedRoomId(room.id)}
                style={{
                  position: 'absolute',
                  left: room.position.x,
                  top: room.position.y,
                  width: room.length * scale,
                  height: room.width * scale,
                  background: room.color,
                  border: selectedRoomId === room.id ? '2px solid #1890ff' : '1px solid #999',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  boxShadow: selectedRoomId === room.id ? '0 0 10px rgba(24,144,255,0.3)' : 'none',
                }}
              >
                <strong>{room.name}</strong>
                <span style={{ fontSize: 10, color: '#666' }}>
                  {room.width}×{room.length}m
                </span>
                <span style={{ fontSize: 10, color: '#1890ff' }}>
                  {room.area.toFixed(1)}㎡
                </span>
              </div>
            ))}

            {/* 家具 */}
            {plan.furnitures.map((fur, index) => {
              const room = plan.rooms.find(r => r.id === fur.roomId);
              if (!room) return null;
              return (
                <div
                  key={fur.id}
                  style={{
                    position: 'absolute',
                    left: room.position.x + 10 + (index % 3) * 60,
                    top: room.position.y + 10 + Math.floor(index / 3) * 40,
                    width: fur.length * scale * 0.3,
                    height: fur.width * scale * 0.3,
                    background: '#8B4513',
                    borderRadius: 2,
                    fontSize: 9,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                  }}
                >
                  {fur.name}
                </div>
              );
            })}
          </div>

          {/* 缩放控制 */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12 }}>缩放:</span>
            <Slider
              min={30}
              max={100}
              value={scale}
              onChange={setScale}
              style={{ width: 150 }}
            />
            <span style={{ fontSize: 12, color: '#666' }}>{scale}px/米</span>
          </div>
        </Card>
      </div>

      {/* 右侧：工具栏 */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 添加房间 */}
        <Card size="small" title="添加空间">
          <Space wrap>
            <Button size="small" onClick={() => addRoom('living')}>客厅</Button>
            <Button size="small" onClick={() => addRoom('bedroom')}>卧室</Button>
            <Button size="small" onClick={() => addRoom('kitchen')}>厨房</Button>
            <Button size="small" onClick={() => addRoom('bathroom')}>卫生间</Button>
            <Button size="small" onClick={() => addRoom('dining')}>餐厅</Button>
            <Button size="small" onClick={() => addRoom('study')}>书房</Button>
            <Button size="small" onClick={() => addRoom('balcony')}>阳台</Button>
          </Space>
        </Card>

        {/* 选中房间编辑 */}
        {selectedRoom && (
          <Card size="small" title={`编辑: ${selectedRoom.name}`}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <span style={{ fontSize: 12 }}>宽度: </span>
                <Input
                  size="small"
                  type="number"
                  value={selectedRoom.width}
                  onChange={e => updateRoomSize(selectedRoom.id, parseFloat(e.target.value), selectedRoom.length)}
                  suffix="m"
                  style={{ width: 100 }}
                />
              </div>
              <div>
                <span style={{ fontSize: 12 }}>长度: </span>
                <Input
                  size="small"
                  type="number"
                  value={selectedRoom.length}
                  onChange={e => updateRoomSize(selectedRoom.id, selectedRoom.width, parseFloat(e.target.value))}
                  suffix="m"
                  style={{ width: 100 }}
                />
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>
                面积: <strong>{selectedRoom.area.toFixed(2)}</strong> ㎡
              </div>
              <Button 
                size="small" 
                danger 
                icon={<DeleteOutlined />}
                onClick={() => deleteRoom(selectedRoom.id)}
              >
                删除房间
              </Button>
            </Space>
          </Card>
        )}

        {/* 添加家具 */}
        <Card size="small" title="添加家具">
          <Select
            size="small"
            style={{ width: '100%' }}
            placeholder="选择家具"
            onSelect={(value: string) => {
              const template = FURNITURE_TEMPLATES.find(t => t.type === value);
              if (template) addFurniture(template);
            }}
          >
            {FURNITURE_TEMPLATES.map(t => (
              <Option key={t.type} value={t.type}>
                {t.name} ({t.width}×{t.length}m)
              </Option>
            ))}
          </Select>
        </Card>

        {/* 空间统计 */}
        <Card size="small" title="空间统计">
          <div style={{ fontSize: 12 }}>
            <div>房间数量: <strong>{plan.rooms.length}</strong> 个</div>
            <div>家具数量: <strong>{plan.furnitures.length}</strong> 件</div>
            <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
              {plan.rooms.map(room => (
                <div key={room.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{room.name}</span>
                  <span>{room.area.toFixed(1)}㎡</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SpacePlanner;
