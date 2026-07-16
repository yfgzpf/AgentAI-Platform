/**
 * SkillPanel - 技能可视化面板
 * 
 * 参考 Reasonix 的技能展示：
 * 1. 显示所有已注册技能
 * 2. 技能分类展示
 * 3. 技能使用统计
 * 4. 技能详情查看
 * 5. 一键调用技能
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Input, Tag, Tooltip, Card, Modal, Button, Empty, Spin, message } from 'antd';
import {
  SearchOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  InfoOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

interface SkillInfo {
  name: string;
  description: string;
  category: string;
  tags: string[];
  triggers?: string[];
  tools?: string[];
  status: 'active' | 'inactive' | 'error';
  lastUsed?: number;
  useCount?: number;
  riskLevel?: 'low' | 'medium' | 'high';
}

interface SkillPanelProps {
  onSkillInvoke?: (skillName: string) => void;
}

export const SkillPanel: React.FC<SkillPanelProps> = ({ onSkillInvoke }) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  // 加载技能列表
  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    try {
      // 从后端获取技能列表
      const response = await fetch('/api/skills/list');
      if (response.ok) {
        const data = await response.json();
        setSkills(data.skills || []);
      } else {
        // 使用模拟数据
        setSkills(getMockSkills());
      }
    } catch (error) {
      console.error('加载技能失败:', error);
      // 使用模拟数据
      setSkills(getMockSkills());
    } finally {
      setLoading(false);
    }
  };

  // 过滤技能
  const filteredSkills = skills.filter(skill => {
    const matchQuery = !query || 
      skill.name.toLowerCase().includes(query.toLowerCase()) ||
      skill.description.toLowerCase().includes(query.toLowerCase()) ||
      skill.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()));
    
    const matchCategory = selectedCategory === 'all' || skill.category === selectedCategory;
    
    return matchQuery && matchCategory;
  });

  // 获取分类
  const categories = ['all', ...new Set(skills.map(s => s.category))];

  // 调用技能
  const handleInvoke = (skill: SkillInfo) => {
    if (onSkillInvoke) {
      onSkillInvoke(skill.name);
    } else {
      message.info(`调用技能: ${skill.name}`);
    }
  };

  // 查看详情
  const handleViewDetail = (skill: SkillInfo) => {
    setSelectedSkill(skill);
    setDetailVisible(true);
  };

  // 获取风险等级颜色
  const getRiskColor = (level?: string): string => {
    switch (level) {
      case 'low': return '#52c41a';
      case 'medium': return '#faad14';
      case 'high': return '#ff4d4f';
      default: return '#8c8c8c';
    }
  };

  // 获取风险等级文字
  const getRiskText = (level?: string): string => {
    switch (level) {
      case 'low': return '低风险';
      case 'medium': return '中风险';
      case 'high': return '高风险';
      default: return '未知';
    }
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
    }}>
      {/* 头部 */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>
            <ThunderboltOutlined style={{ marginRight: 8, color: 'var(--accent)' }} />
            技能中心
          </h3>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={loadSkills}
            size="small"
          >
            刷新
          </Button>
        </div>

        {/* 搜索框 */}
        <Input
          placeholder="搜索技能..."
          prefix={<SearchOutlined />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
        />
      </div>

      {/* 分类标签 */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {categories.map(cat => (
          <Tag
            key={cat}
            color={selectedCategory === cat ? 'blue' : undefined}
            style={{ cursor: 'pointer', marginBottom: 4 }}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat === 'all' ? '全部' : cat}
            {cat !== 'all' && ` (${skills.filter(s => s.category === cat).length})`}
          </Tag>
        ))}
      </div>

      {/* 技能列表 */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="加载技能..." />
          </div>
        ) : filteredSkills.length === 0 ? (
          <Empty
            description={query ? '没有找到匹配的技能' : '暂无可用技能'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredSkills.map(skill => (
              <Card
                key={skill.name}
                size="small"
                hoverable
                onClick={() => handleViewDetail(skill)}
                style={{
                  borderRadius: 8,
                  borderLeft: skill.status === 'active' ? '3px solid #52c41a' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 技能名称 */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 4,
                    }}>
                      <span style={{
                        fontWeight: 500,
                        fontSize: 13,
                        color: 'var(--fg)',
                      }}>
                        {skill.name}
                      </span>
                      </div>

                    {/* 描述 */}
                    <div style={{
                      fontSize: 11,
                      color: 'var(--muted-2)',
                      marginBottom: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {skill.description}
                    </div>

                    {/* 标签 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {skill.tags.slice(0, 3).map(tag => (
                        <Tag key={tag} style={{ fontSize: 10 }}>{tag}</Tag>
                      ))}
                      {skill.tags.length > 3 && (
                        <Tag style={{ fontSize: 10 }}>+{skill.tags.length - 3}</Tag>
                      )}
                      
                      {/* 风险等级 */}
                      <Tag
                        color={getRiskColor(skill.riskLevel)}
                        style={{ fontSize: 10 }}
                      >
                        {getRiskText(skill.riskLevel)}
                      </Tag>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 8 }}>
                    <Tooltip title="立即使用">
                      <Button
                        type="primary"
                        size="small"
                        icon={<PlayCircleOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInvoke(skill);
                        }}
                        disabled={skill.status !== 'active'}
                        style={{ fontSize: 11 }}
                      >
                        使用
                      </Button>
                    </Tooltip>
                    
                    {skill.useCount !== undefined && (
                      <span style={{ fontSize: 10, color: 'var(--muted-2)', textAlign: 'center' }}>
                        {skill.useCount}次使用
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-around',
        fontSize: 12,
        color: 'var(--muted-2)',
      }}>
        <span><CheckCircleOutlined /> {skills.filter(s => s.status === 'active').length} 可用</span>
        <span><ClockCircleOutlined /> {skills.reduce((sum, s) => sum + (s.useCount || 0), 0)} 总调用</span>
      </div>

      {/* 详情弹窗 */}
      <Modal
        title={`技能详情: ${selectedSkill?.name}`}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>
            关闭
          </Button>,
          <Button
            key="invoke"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => {
              if (selectedSkill) {
                handleInvoke(selectedSkill);
                setDetailVisible(false);
              }
            }}
          >
            立即使用
          </Button>,
        ]}
        width={600}
      >
        {selectedSkill && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8 }}>描述</h4>
              <p style={{ color: 'var(--fg-2)', lineHeight: 1.6 }}>
                {selectedSkill.description}
              </p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8 }}>分类</h4>
              <Tag color="blue">{selectedSkill.category}</Tag>
            </div>

            {selectedSkill.triggers && selectedSkill.triggers.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>触发词</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedSkill.triggers.map((trigger, i) => (
                    <Tag key={i} color="orange">{trigger}</Tag>
                  ))}
                </div>
              </div>
            )}

            {selectedSkill.tools && selectedSkill.tools.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>依赖工具</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedSkill.tools.map((tool, i) => (
                    <Tag key={i}>{tool}</Tag>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 style={{ marginBottom: 8 }}>状态</h4>
              <Tag color={selectedSkill.status === 'active' ? 'success' : 'default'}>
                {selectedSkill.status === 'active' ? '可用' : '不可用'}
              </Tag>
              
              {selectedSkill.lastUsed && (
                <span style={{ marginLeft: 12, color: 'var(--muted-2)', fontSize: 12 }}>
                  上次使用: {new Date(selectedSkill.lastUsed).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// 模拟数据（用于测试）
function getMockSkills(): SkillInfo[] {
  return [
    {
      name: 'quotation-generator',
      description: '智能装修报价生成器，根据户型、面积、风格自动生成详细报价单，支持Excel导出',
      category: 'decoration',
      tags: ['报价', '预算', '装修', 'Excel'],
      triggers: ['生成.*报价', '多少钱.*装修'],
      tools: ['read_file', 'write_file', 'create_excel'],
      status: 'active',
      useCount: 23,
      riskLevel: 'low',
      lastUsed: Date.now() - 3600000,
    },
    {
      name: 'comment-interception-system',
      description: '评论截流获客系统，监控抖音/小红书评论区，自动识别意向用户并回复',
      category: 'marketing',
      tags: ['获客', '截流', '抖音', '小红书'],
      triggers: ['启动截流获客', '监控.*评论区'],
      tools: ['browser_automation', 'send_message'],
      status: 'active',
      useCount: 15,
      riskLevel: 'medium',
      lastUsed: Date.now() - 7200000,
    },
    {
      name: 'cad-ai-designer',
      description: 'CAD图纸AI设计师，自动识别CAD图纸内容，提取尺寸和材料信息',
      category: 'decoration',
      tags: ['CAD', '图纸', '设计', '识别'],
      triggers: ['识别.*图纸', '解析.*CAD'],
      tools: ['read_file', 'image_analysis'],
      status: 'active',
      useCount: 8,
      riskLevel: 'low',
      lastUsed: Date.now() - 86400000,
    },
    {
      name: 'material-selector',
      description: '智能材料选择器，根据预算和风格推荐合适的装修材料方案',
      category: 'decoration',
      tags: ['材料', '选择', '推荐', '预算'],
      triggers: ['选择材料', '推荐.*材料'],
      tools: ['search_knowledge', 'read_file'],
      status: 'active',
      useCount: 31,
      riskLevel: 'low',
      lastUsed: Date.now() - 1800000,
    },
    {
      name: 'lead-generation-system',
      description: '线索生成系统，从多个渠道自动收集潜在客户信息并分类管理',
      category: 'marketing',
      tags: ['线索', '获客', '客户', '管理'],
      triggers: ['生成线索', '收集客户'],
      tools: ['web_scrape', 'database', 'email'],
      status: 'inactive',
      useCount: 0,
      riskLevel: 'medium',
    },
  ];
}
