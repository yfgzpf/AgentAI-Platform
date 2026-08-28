/**
 * MaterialPriceManager — 材料价格管理组件
 * 
 * 核心价值：
 * - 用户上传本地区材料价格表（Excel/CSV）
 * - 数据存储在后端 ~/.agentai/materials-prices/，打包后可用
 * - 预算计算使用用户上传的真实价格
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Upload, Table, Tag, Space, Typography, Alert,
  Modal, Form, Input, Select, InputNumber, message, Empty, Spin,
  Tabs, Statistic, Row, Col, Tooltip
} from 'antd';
import {
  UploadOutlined, DownloadOutlined, PlusOutlined,
  DeleteOutlined, EditOutlined, FileExcelOutlined,
  DollarOutlined, EnvironmentOutlined, SyncOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

// ==================== 类型定义 ====================

interface MaterialPrice {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  price: number;
  unit: string;
  brand?: string;
  spec?: string;
  region?: string;
  source: string;
  updatedAt: number;
}

interface PriceTable {
  version: string;
  region: string;
  updatedAt: number;
  materials: MaterialPrice[];
}

// ==================== 组件 ====================

export const MaterialPriceManager: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [priceTable, setPriceTable] = useState<PriceTable | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialPrice | null>(null);
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);

  // 加载价格表
  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/materials');
      const data = await res.json();
      if (data.ok) {
        setPriceTable(data.data);
      } else {
        message.error(data.error || '加载失败');
      }
    } catch (err) {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  // 上传价格表
  const handleUpload = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('region', '用户上传');

    try {
      const res = await fetch('/v1/materials/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        message.success(data.message);
        loadPrices();
      } else {
        message.error(data.error || '上传失败');
      }
    } catch (err) {
      message.error('上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  // 下载模板
  const downloadTemplate = () => {
    window.open('/v1/materials/template', '_blank');
  };

  // 添加/编辑材料
  const handleSave = async (values: any) => {
    try {
      const url = editingMaterial 
        ? `/v1/materials/${editingMaterial.id}`
        : '/v1/materials/add';
      
      const res = await fetch(url, {
        method: editingMaterial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      
      const data = await res.json();
      if (data.ok) {
        message.success(editingMaterial ? '已更新' : '已添加');
        setIsModalOpen(false);
        setEditingMaterial(null);
        form.resetFields();
        loadPrices();
      } else {
        message.error(data.error);
      }
    } catch (err) {
      message.error('保存失败');
    }
  };

  // 删除材料
  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，是否继续？',
      onOk: async () => {
        try {
          const res = await fetch(`/v1/materials/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.ok) {
            message.success('已删除');
            loadPrices();
          } else {
            message.error(data.error);
          }
        } catch (err) {
          message.error('删除失败');
        }
      },
    });
  };

  // 打开编辑
  const openEdit = (material: MaterialPrice) => {
    setEditingMaterial(material);
    form.setFieldsValue(material);
    setIsModalOpen(true);
  };

  // 打开新增
  const openAdd = () => {
    setEditingMaterial(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  // 表格列
  const columns = [
    {
      title: '材料名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: MaterialPrice) => (
        <div>
          <div style={{ fontWeight: 500 }}>{text}</div>
          {record.spec && <div style={{ fontSize: 12, color: '#999' }}>{record.spec}</div>}
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) => {
        const catMap: Record<string, string> = {
          floor: '地板',
          wall: '墙面',
          ceiling: '吊顶',
          furniture: '家具',
          lighting: '灯具',
          hardware: '五金',
          soft: '软装',
          labor: '人工',
        };
        return <Tag>{catMap[cat] || cat}</Tag>;
      },
    },
    {
      title: '单价',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      render: (price: number, record: MaterialPrice) => (
        <span style={{ color: '#f5222d', fontWeight: 500 }}>
          ¥{price}
          <span style={{ fontSize: 12, color: '#999', marginLeft: 4 }}>{record.unit}</span>
        </span>
      ),
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      key: 'brand',
      width: 120,
      render: (brand?: string) => brand || '-',
    },
    {
      title: '地区',
      dataIndex: 'region',
      key: 'region',
      width: 100,
      render: (region?: string) => region || '全国',
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (source: string) => (
        <Tag color={source === 'user-upload' ? 'blue' : 'default'}>
          {source === 'user-upload' ? '用户上传' : '手动添加'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: MaterialPrice) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      ),
    },
  ];

  // 分类统计
  const categoryStats = priceTable?.materials.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <DollarOutlined style={{ marginRight: 8 }} />
              材料价格管理
            </Title>
            <Paragraph type="secondary" style={{ margin: '8px 0 0 0' }}>
              上传本地区材料价格表，用于精准预算计算
            </Paragraph>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
              下载模板
            </Button>
            <Upload
              beforeUpload={handleUpload}
              showUploadList={false}
              accept=".xlsx,.xls,.csv,.json"
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传价格表
              </Button>
            </Upload>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              添加材料
            </Button>
          </Space>
        </div>

        {/* 统计信息 */}
        {priceTable && priceTable.materials.length > 0 && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={6}>
              <Card size="small">
                <Statistic
                  title="材料总数"
                  value={priceTable.materials.length}
                  suffix="种"
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic
                  title="适用地区"
                  value={priceTable.region}
                  prefix={<EnvironmentOutlined />}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic
                  title="最后更新"
                  value={new Date(priceTable.updatedAt).toLocaleDateString()}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Button 
                  icon={<SyncOutlined />} 
                  onClick={loadPrices}
                  loading={loading}
                  block
                >
                  刷新数据
                </Button>
              </Card>
            </Col>
          </Row>
        )}

        {/* 空状态 */}
        {!loading && (!priceTable || priceTable.materials.length === 0) && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>暂无材料价格数据</div>
                <Paragraph type="secondary">
                  请上传材料价格表，或手动添加材料价格<br />
                  支持 Excel、CSV、JSON 格式
                </Paragraph>
                <Space style={{ marginTop: 16 }}>
                  <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                    下载模板
                  </Button>
                  <Upload
                    beforeUpload={handleUpload}
                    showUploadList={false}
                    accept=".xlsx,.xls,.csv,.json"
                  >
                    <Button type="primary" icon={<UploadOutlined />}>
                      上传价格表
                    </Button>
                  </Upload>
                </Space>
              </div>
            }
          />
        )}

        {/* 数据表格 */}
        {priceTable && priceTable.materials.length > 0 && (
          <Tabs
            items={[
              {
                key: 'all',
                label: `全部 (${priceTable.materials.length})`,
                children: (
                  <Table
                    columns={columns}
                    dataSource={priceTable.materials}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                    size="small"
                  />
                ),
              },
              ...(categoryStats ? Object.entries(categoryStats).map(([cat, count]) => ({
                key: cat,
                label: `${cat} (${count})`,
                children: (
                  <Table
                    columns={columns}
                    dataSource={priceTable.materials.filter(m => m.category === cat)}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                    size="small"
                  />
                ),
              })) : []),
            ]}
          />
        )}
      </Card>

      {/* 添加/编辑弹窗 */}
      <Modal
        title={editingMaterial ? '编辑材料' : '添加材料'}
        open={isModalOpen}
        onOk={() => form.submit()}
        onCancel={() => {
          setIsModalOpen(false);
          setEditingMaterial(null);
          form.resetFields();
        }}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
        >
          <Form.Item
            name="name"
            label="材料名称"
            rules={[{ required: true, message: '请输入材料名称' }]}
          >
            <Input placeholder="如：实木复合地板" />
          </Form.Item>

          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true }]}
          >
            <Select placeholder="选择分类">
              <Option value="floor">地板</Option>
              <Option value="wall">墙面</Option>
              <Option value="ceiling">吊顶</Option>
              <Option value="furniture">家具</Option>
              <Option value="lighting">灯具</Option>
              <Option value="hardware">五金</Option>
              <Option value="soft">软装</Option>
              <Option value="labor">人工</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="subCategory"
            label="子分类"
          >
            <Input placeholder="如：木地板" />
          </Form.Item>

          <Form.Item
            name="price"
            label="单价"
            rules={[{ required: true, message: '请输入单价' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="0.00"
            />
          </Form.Item>

          <Form.Item
            name="unit"
            label="单位"
            rules={[{ required: true }]}
          >
            <Input placeholder="如：元/㎡" />
          </Form.Item>

          <Form.Item
            name="brand"
            label="品牌"
          >
            <Input placeholder="如：圣象" />
          </Form.Item>

          <Form.Item
            name="spec"
            label="规格"
          >
            <Input placeholder="如：15mm厚 E0级" />
          </Form.Item>

          <Form.Item
            name="region"
            label="地区"
          >
            <Input placeholder="如：北京" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MaterialPriceManager;
