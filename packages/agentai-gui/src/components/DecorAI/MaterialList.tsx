/**
 * MaterialList — 材料清单与预算表
 * 
 * 为设计师提供:
 *   - 自动材料清单生成
 *   - 预算估算
 *   - 供应商推荐
 *   - 导出Excel/PDF
 */

import React, { useState, useMemo } from 'react';
import { 
  Card, Table, Button, Space, Tag, InputNumber, 
  Select, message, Tooltip, Row, Col, Statistic,
  Tabs, List, Badge
} from 'antd';
import { 
  DownloadOutlined, FileExcelOutlined, FilePdfOutlined,
  PlusOutlined, DeleteOutlined, CalculatorOutlined,
  ShoppingOutlined, DollarOutlined,
} from '@ant-design/icons';
import type { Material, MaterialPackage } from './materials';
import { 
  getMaterialsByStyle, getMaterialById, getMaterialPackageByStyle,
  FLOOR_MATERIALS, WALL_MATERIALS, CEILING_MATERIALS, FURNITURE_MATERIALS, LIGHTING_MATERIALS
} from './materials';

const { Option } = Select;
const { TabPane } = Tabs;

// ==================== 类型定义 ====================

interface MaterialItem {
  id: string;
  materialId: string;
  material: Material;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  note?: string;
}

interface BudgetCategory {
  category: string;
  items: MaterialItem[];
  subtotal: number;
}

interface ProjectBudget {
  id: string;
  name: string;
  area: number;
  style: string;
  categories: BudgetCategory[];
  materialTotal: number;
  laborCost: number;
  designFee: number;
  managementFee: number;
  total: number;
}

// ==================== 组件 ====================

interface MaterialListProps {
  style?: string;
  area?: number;
  onExport?: (budget: ProjectBudget) => void;
}

export const MaterialList: React.FC<MaterialListProps> = ({ 
  style = 'modern', 
  area = 100,
  onExport,
}) => {
  const [selectedStyle, setSelectedStyle] = useState(style);
  const [projectArea, setProjectArea] = useState(area);
  const [activeTab, setActiveTab] = useState('auto');
  const [customItems, setCustomItems] = useState<MaterialItem[]>([]);

  // 自动生成材料清单
  const autoBudget: ProjectBudget = useMemo(() => {
    const pkg = getMaterialPackageByStyle(selectedStyle, projectArea);
    
    const categories: BudgetCategory[] = [];
    const categoryMap: Record<string, MaterialItem[]> = {};

    pkg.materials?.forEach(m => {
      const material = getMaterialById(m.materialId);
      if (!material) return;

      const item: MaterialItem = {
        id: `item-${m.materialId}`,
        materialId: m.materialId,
        material,
        quantity: m.quantity,
        unit: m.unit,
        unitPrice: (material.priceRange.min + material.priceRange.max) / 2,
        totalPrice: ((material.priceRange.min + material.priceRange.max) / 2) * m.quantity,
      };

      const categoryName = getCategoryName(material.category);
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = [];
      }
      categoryMap[categoryName].push(item);
    });

    Object.entries(categoryMap).forEach(([category, items]) => {
      categories.push({
        category,
        items,
        subtotal: items.reduce((sum, item) => sum + item.totalPrice, 0),
      });
    });

    const materialTotal = categories.reduce((sum, cat) => sum + cat.subtotal, 0);
    const laborCost = (pkg.laborCost?.min || 0 + pkg.laborCost?.max || 0) / 2;
    const designFee = materialTotal * 0.08; // 设计费8%
    const managementFee = materialTotal * 0.05; // 管理费5%

    return {
      id: `budget-${Date.now()}`,
      name: `${getStyleLabel(selectedStyle)} - ${projectArea}㎡`,
      area: projectArea,
      style: selectedStyle,
      categories,
      materialTotal,
      laborCost,
      designFee,
      managementFee,
      total: materialTotal + laborCost + designFee + managementFee,
    };
  }, [selectedStyle, projectArea]);

  // 合并自动和自定义
  const finalBudget: ProjectBudget = useMemo(() => {
    if (activeTab === 'auto') return autoBudget;
    
    // 自定义模式
    const categories: BudgetCategory[] = [];
    const categoryMap: Record<string, MaterialItem[]> = {};

    customItems.forEach(item => {
      const categoryName = getCategoryName(item.material.category);
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = [];
      }
      categoryMap[categoryName].push(item);
    });

    Object.entries(categoryMap).forEach(([category, items]) => {
      categories.push({
        category,
        items,
        subtotal: items.reduce((sum, item) => sum + item.totalPrice, 0),
      });
    });

    const materialTotal = categories.reduce((sum, cat) => sum + cat.subtotal, 0);
    const laborCost = projectArea * 500; // 默认人工500/㎡
    const designFee = materialTotal * 0.08;
    const managementFee = materialTotal * 0.05;

    return {
      id: `budget-custom-${Date.now()}`,
      name: `自定义清单 - ${projectArea}㎡`,
      area: projectArea,
      style: 'custom',
      categories,
      materialTotal,
      laborCost,
      designFee,
      managementFee,
      total: materialTotal + laborCost + designFee + managementFee,
    };
  }, [activeTab, autoBudget, customItems, projectArea]);

  // 添加自定义材料
  const addCustomItem = (materialId: string) => {
    const material = getMaterialById(materialId);
    if (!material) return;

    const newItem: MaterialItem = {
      id: `custom-${Date.now()}`,
      materialId,
      material,
      quantity: 1,
      unit: material.priceRange.unit,
      unitPrice: (material.priceRange.min + material.priceRange.max) / 2,
      totalPrice: (material.priceRange.min + material.priceRange.max) / 2,
    };

    setCustomItems([...customItems, newItem]);
  };

  // 更新数量
  const updateQuantity = (id: string, quantity: number) => {
    setCustomItems(items => 
      items.map(item => 
        item.id === id 
          ? { ...item, quantity, totalPrice: item.unitPrice * quantity }
          : item
      )
    );
  };

  // 删除自定义项
  const removeCustomItem = (id: string) => {
    setCustomItems(items => items.filter(item => item.id !== id));
  };

  // 导出Excel
  const exportExcel = () => {
    // 生成CSV内容
    let csv = '材料清单,\n';
    csv += `项目,${finalBudget.name},\n`;
    csv += `面积,${finalBudget.area}㎡,\n`;
    csv += `风格,${getStyleLabel(finalBudget.style)},\n\n`;
    csv += '分类,材料名称,规格,品牌,数量,单位,单价,总价,备注\n';

    finalBudget.categories.forEach(cat => {
      cat.items.forEach(item => {
        csv += `${cat.category},${item.material.name},"${item.material.specs.join('; ')}","${item.material.brands.join('/')}",${item.quantity},${item.unit},${item.unitPrice},${item.totalPrice.toFixed(2)},${item.note || ''}\n`;
      });
    });

    csv += `\n,\n材料费合计,,,,,,${finalBudget.materialTotal.toFixed(2)}\n`;
    csv += `人工费,,,,,,${finalBudget.laborCost.toFixed(2)}\n`;
    csv += `设计费(8%),,,,,,${finalBudget.designFee.toFixed(2)}\n`;
    csv += `管理费(5%),,,,,,${finalBudget.managementFee.toFixed(2)}\n`;
    csv += `总计,,,,,,${finalBudget.total.toFixed(2)}\n`;

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `材料清单_${finalBudget.name}.csv`;
    link.click();
    message.success('材料清单已导出');
  };

  const columns = [
    {
      title: '材料名称',
      dataIndex: ['material', 'name'],
      key: 'name',
      render: (text: string, record: MaterialItem) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{text}</span>
          <span style={{ fontSize: 11, color: '#666' }}>{record.material.brands[0]}等</span>
        </Space>
      ),
    },
    {
      title: '规格',
      dataIndex: ['material', 'specs'],
      key: 'specs',
      render: (specs: string[]) => (
        <span style={{ fontSize: 11 }}>{specs.slice(0, 2).join(', ')}</span>
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      render: (qty: number, record: MaterialItem) => 
        activeTab === 'custom' ? (
          <InputNumber
            size="small"
            min={0}
            value={qty}
            onChange={val => updateQuantity(record.id, val || 0)}
            style={{ width: 80 }}
          />
        ) : (
          <span>{qty.toFixed(2)}</span>
        ),
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      render: (price: number) => `¥${price.toFixed(0)}`,
    },
    {
      title: '总价',
      dataIndex: 'totalPrice',
      key: 'totalPrice',
      render: (price: number) => <strong>¥{price.toFixed(0)}</strong>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: MaterialItem) => 
        activeTab === 'custom' && (
          <Button 
            size="small" 
            danger 
            icon={<DeleteOutlined />}
            onClick={() => removeCustomItem(record.id)}
          />
        ),
    },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部控制栏 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Space>
              <span>风格:</span>
              <Select
                size="small"
                value={selectedStyle}
                onChange={setSelectedStyle}
                style={{ width: 120 }}
                disabled={activeTab === 'custom'}
              >
                <Option value="modern">现代简约</Option>
                <Option value="french">法式轻奢</Option>
                <Option value="wabi">侘寂风</Option>
                <Option value="nordic">北欧风</Option>
                <Option value="new-chinese">新中式</Option>
              </Select>
            </Space>
          </Col>
          <Col>
            <Space>
              <span>面积:</span>
              <InputNumber
                size="small"
                min={10}
                max={500}
                value={projectArea}
                onChange={val => setProjectArea(val || 100)}
                suffix="㎡"
                style={{ width: 100 }}
              />
            </Space>
          </Col>
          <Col flex={1}>
            <Space>
              <Button 
                size="small" 
                icon={<FileExcelOutlined />}
                onClick={exportExcel}
              >
                导出Excel
              </Button>
              <Button 
                size="small" 
                icon={<FilePdfOutlined />}
                onClick={() => message.info('PDF导出开发中')}
              >
                导出PDF
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 预算概览 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic
              title="材料费"
              value={finalBudget.materialTotal}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 18, color: '#1890ff' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="人工费"
              value={finalBudget.laborCost}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 18, color: '#52c41a' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="设计+管理"
              value={finalBudget.designFee + finalBudget.managementFee}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 18, color: '#faad14' }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="总预算"
              value={finalBudget.total}
              prefix="¥"
              precision={0}
              valueStyle={{ fontSize: 20, color: '#f5222d', fontWeight: 'bold' }}
            />
            <div style={{ fontSize: 11, color: '#666' }}>
              约 {(finalBudget.total / projectArea).toFixed(0)} 元/㎡
            </div>
          </Col>
        </Row>
      </Card>

      {/* 详细清单 */}
      <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ flex: 1 }}>
        <TabPane tab="智能推荐" key="auto">
          {finalBudget.categories.map(cat => (
            <Card 
              key={cat.category} 
              size="small" 
              title={cat.category}
              extra={<Tag color="blue">¥{cat.subtotal.toFixed(0)}</Tag>}
              style={{ marginBottom: 12 }}
            >
              <Table
                size="small"
                columns={columns.filter(c => c.key !== 'action')}
                dataSource={cat.items}
                rowKey="id"
                pagination={false}
              />
            </Card>
          ))}
        </TabPane>
        
        <TabPane tab="自定义清单" key="custom">
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space wrap>
              <span>添加材料:</span>
              <Select
                size="small"
                style={{ width: 200 }}
                placeholder="选择材料"
                onSelect={addCustomItem}
              >
                <Option disabled style={{ fontWeight: 'bold' }}>地板</Option>
                {FLOOR_MATERIALS.map(m => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
                <Option disabled style={{ fontWeight: 'bold' }}>墙面</Option>
                {WALL_MATERIALS.map(m => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
                <Option disabled style={{ fontWeight: 'bold' }}>吊顶</Option>
                {CEILING_MATERIALS.map(m => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
                <Option disabled style={{ fontWeight: 'bold' }}>家具</Option>
                {FURNITURE_MATERIALS.map(m => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
                <Option disabled style={{ fontWeight: 'bold' }}>灯光</Option>
                {LIGHTING_MATERIALS.map(m => (
                  <Option key={m.id} value={m.id}>{m.name}</Option>
                ))}
              </Select>
            </Space>
          </Card>

          {finalBudget.categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              <ShoppingOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <p>点击上方"添加材料"开始创建清单</p>
            </div>
          ) : (
            finalBudget.categories.map(cat => (
              <Card 
                key={cat.category} 
                size="small" 
                title={cat.category}
                extra={<Tag color="blue">¥{cat.subtotal.toFixed(0)}</Tag>}
                style={{ marginBottom: 12 }}
              >
                <Table
                  size="small"
                  columns={columns}
                  dataSource={cat.items}
                  rowKey="id"
                  pagination={false}
                />
              </Card>
            ))
          )}
        </TabPane>
      </Tabs>
    </div>
  );
};

// ==================== 辅助函数 ====================

function getCategoryName(category: string): string {
  const map: Record<string, string> = {
    floor: '地面材料',
    wall: '墙面材料',
    ceiling: '吊顶材料',
    furniture: '定制家具',
    lighting: '灯光照明',
    hardware: '五金配件',
    soft: '软装布艺',
  };
  return map[category] || category;
}

function getStyleLabel(style: string): string {
  const map: Record<string, string> = {
    modern: '现代简约',
    french: '法式轻奢',
    wabi: '侘寂风',
    nordic: '北欧风',
    'new-chinese': '新中式',
    custom: '自定义',
  };
  return map[style] || style;
}

export default MaterialList;
