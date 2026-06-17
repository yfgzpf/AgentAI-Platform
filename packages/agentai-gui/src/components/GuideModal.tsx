/**
 * GuideModal — 使用指南弹窗
 * --------------------------------------------------
 * 完整的系统架构说明、UI 功能描述、图表触发说明
 */
import React from 'react';
import { Modal, Tabs, Tag } from 'antd';
import { CloseOutlined, BookOutlined, AppstoreOutlined, ThunderboltOutlined, PictureOutlined, CodeOutlined } from '@ant-design/icons';

interface Props {
  onClose: () => void;
}

const SECTION = {
  title: (text: string) => (
    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginBottom: 8, marginTop: 12 }}>
      {text}
    </div>
  ),
  desc: (text: string) => (
    <div style={{ fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.7, marginBottom: 6 }}>{text}</div>
  ),
  tag: (label: string, color = 'blue') => (
    <Tag color={color} style={{ fontSize: 10, marginRight: 4, marginBottom: 4 }}>{label}</Tag>
  ),
  code: (text: string) => (
    <code style={{
      fontSize: 11, padding: '1px 5px', borderRadius: 3,
      background: 'var(--panel)', border: '1px solid var(--border)',
      fontFamily: 'monospace', color: 'var(--accent)',
    }}>{text}</code>
  ),
  divider: () => (
    <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0' }} />
  ),
};

export const GuideModal: React.FC<Props> = ({ onClose }) => {
  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={720}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOutlined style={{ color: 'var(--accent)' }} />
          <span>x-agent 使用指南</span>
          <Tag color="purple" style={{ fontSize: 9 }}>v0.4.0</Tag>
        </div>
      }
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '12px 20px' } }}
    >
      <Tabs
        defaultActiveKey="overview"
        items={[
          /* ====== 1. 系统概览 ====== */
          {
            key: 'overview',
            label: '系统概览',
            children: (
              <div>
                {SECTION.title('x-agent 是什么?')}
                {SECTION.desc('x-agent 是一个多模型 AI 平台，支持智能对话、代码编辑、图像生成、视频生成、写作等功能。采用 Gateway + GUI 分离架构，Gateway 提供 LLM 路由、工具调用、记忆管理，GUI 提供交互界面。')}

                {SECTION.title('系统架构')}
                {/* 架构图用文本流程图表示 */}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 16, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8,
                  color: 'var(--fg-2)', whiteSpace: 'pre', overflowX: 'auto',
                }}>{`┌─────────────────────────────────────────────────────────┐
│                    x-agent                       │
├──────────┬──────────────┬──────────────┬────────────────┤
│  GUI     │   Gateway    │   Core       │   Skills       │
│ (React)  │  (Node 22)   │  (Types)     │  (Python)      │
│          │              │              │                │
│ 对话界面  │ LLM 路由     │ 类型定义     │ 25+ 技能脚本   │
│ 编辑器    │ 工具注册     │ 接口规范     │ 自动发现加载   │
│ 生图/视频 │ 记忆管理     │              │                │
│ 写作      │ 技能调度     │              │                │
│ 设置      │ 自主修复     │              │                │
├──────────┴──────────────┴──────────────┴────────────────┤
│  数据流: GUI ──HTTP/SSE──→ Gateway ──LLM API──→ 模型    │
│  工具流: Gateway ──ToolRegistry──→ Skills/文件/浏览器    │
│  记忆流: Gateway ──MemoryEngine──→ 持久化存储            │
└─────────────────────────────────────────────────────────┘`}</div>

                {SECTION.divider()}
                {SECTION.title('核心模块')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { name: 'LLM Router', desc: '4 Provider 路由: agentai / deepseek / openai / cline', tag: 'gateway' },
                    { name: 'x-agent Loop', desc: '主循环: LLM调用→工具分派→结果入log→继续循环', tag: 'gateway' },
                    { name: 'Tool Registry', desc: '工具注册中心, 支持并行/串行分块执行', tag: 'gateway' },
                    { name: 'Memory Engine', desc: '持久记忆 + 会话记忆 + 行业记忆', tag: 'gateway' },
                    { name: 'Industry Engine', desc: '行业引擎: 装修/电商/教育/漫画等', tag: 'gateway' },
                    { name: 'Skill Orchestrator', desc: '技能调度器, 智能匹配并触发技能', tag: 'gateway' },
                    { name: 'Token Compressor', desc: '工具输出语义压缩, 节省70-85% token', tag: 'gateway' },
                    { name: 'Goal Runner', desc: '目标驱动执行: 拆解→验证→修正→报告', tag: 'gateway' },
                  ].map(m => (
                    <div key={m.name} style={{
                      padding: '6px 8px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>
                        {SECTION.tag(m.tag, 'geekblue')}
                        {m.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{m.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },

          /* ====== 2. UI 功能 ====== */
          {
            key: 'ui',
            label: 'UI 功能',
            children: (
              <div>
                {SECTION.title('顶部导航栏')}
                {SECTION.desc('包含: 品牌标识 → 页面导航 Tab → 模型选择 → 主题/字体 → 侧栏开关 → GitHub → 用户名')}

                {SECTION.title('页面功能一览')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { icon: '💬', name: '对话', desc: 'AI 智能对话, 多模型切换, 工具调用, 流式响应, 情绪感知', features: ['4种运行模式', '提示词优化', '语音输入/播报', '深度思考', 'Web搜索', '文件附件'] },
                    { icon: '💻', name: '编辑器', desc: 'VSCode 风格代码编辑, AI 改写, 多标签页', features: ['语法高亮', 'AI改写', '文件浏览'] },
                    { icon: '🎨', name: '生图', desc: '文生图, Agnes 2.1 Flash 模型', features: ['多尺寸', '行业提示词'] },
                    { icon: '🎬', name: '生视频', desc: '文生视频, 5秒短视频', features: ['行业提示词'] },
                    { icon: '✍️', name: '写作', desc: '长文写作, 模板, 一键导出', features: ['Markdown', '预览'] },
                    { icon: '📦', name: '技能库', desc: '25+ 技能, 7分类', features: ['自动发现', '手动触发'] },
                    { icon: '🧹', name: '智能清理', desc: '扫描/分类/安全清理', features: ['规则管理'] },
                    { icon: '⚙️', name: '设置', desc: '密钥/框架/模型/主题', features: ['4 Provider', '5主题'] },
                  ].map(p => (
                    <div key={p.name} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 16 }}>{p.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted-2)', flex: 1 }}>{p.desc}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.features.map(f => SECTION.tag(f, 'cyan'))}
                      </div>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('对话框工具栏 (Composer)')}
                {SECTION.desc('对话框底部工具栏包含以下功能按钮 (从左到右):')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {[
                    { icon: '📎', name: '文件上传', desc: '支持图片/Excel/文档等附件' },
                    { icon: '🖼️', name: '图片上传', desc: '拖拽或点击上传图片' },
                    { icon: '🌐', name: 'Web搜索', desc: '开启后AI自动搜索互联网' },
                    { icon: '✨', name: '提示词优化', desc: 'AI分析评分并增强提示词' },
                    { icon: '🎤', name: '语音输入', desc: '浏览器语音识别转文字' },
                    { icon: '🔊', name: '语音播报', desc: 'AI回复自动TTS朗读' },
                    { icon: '🔔', name: '语音唤醒', desc: '语音唤醒词激活AI' },
                    { icon: '💡', name: '深度思考', desc: '编码/推理任务推荐开启' },
                    { icon: '🤖', name: '模型选择', desc: '切换当前对话模型' },
                    { icon: '▶', name: '运行模式', desc: '自动/规划/审查/只读' },
                  ].map(b => (
                    <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px' }}>
                      <span style={{ fontSize: 14 }}>{b.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg-2)' }}>{b.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>— {b.desc}</span>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('右侧面板')}
                {SECTION.desc('对话页右侧信息面板包含:')}
                {['上下文注入 (模型/消息/工具/规则/记忆)', '工具调用 (AI工具调用详情)', '记忆 (持久记忆文件管理)', '浏览器 (AI自动化)', '识别 (界面元素识别)', '时间线 (文件变更记录)'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}

                {SECTION.divider()}
                {SECTION.title('工作区摘要栏')}
                {SECTION.desc('对话窗口上方的可折叠栏, 包含:')}
                {['工作目录设置 (手动输入或浏览选择)', '行业身份切换 (通用/开发者/装修/电商/教育/漫画)', '对话摘要 (消息数/时长/Token用量)', 'Token用量警告 (>80%显示)'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}
              </div>
            ),
          },

          /* ====== 3. 运行模式 ====== */
          {
            key: 'modes',
            label: '运行模式',
            children: (
              <div>
                {SECTION.title('4 种运行模式')}
                {SECTION.desc('在对话框底部工具栏切换, 影响AI可用的工具范围:')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { name: '自动模式 (auto)', color: '#22c55e', desc: '全部工具可用, AI自主决策调用工具', detail: '默认模式, 适合大多数场景' },
                    { name: '规划模式 (planning)', color: '#3b82f6', desc: '只读工具 + 任务规划审批', detail: 'AI先制定计划, 用户确认后执行' },
                    { name: '审查模式 (review)', color: '#f59e0b', desc: '只读工具 + 审查系统提示', detail: '代码审查/安全审计专用' },
                    { name: '只读模式 (readonly)', color: '#6b7280', desc: '无工具, 纯对话', detail: '简单问答, 不调用任何工具' },
                  ].map(m => (
                    <div key={m.name} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: 'var(--card)', border: `1px solid ${m.color}33`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{m.desc}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>{m.detail}</div>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('行业身份')}
                {SECTION.desc('在工作区摘要栏展开后可切换行业身份。切换后AI会自动:')}
                {['加载行业专属技能和工具', '更新系统提示中的行业上下文', '切换行业知识库', '通用模式 = 不设定AI角色, 默认选项'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}
              </div>
            ),
          },

          /* ====== 4. 图表与流程图 ====== */
          {
            key: 'diagrams',
            label: '图表/流程图',
            children: (
              <div>
                {SECTION.title('AI 生成图表功能')}
                {SECTION.desc('x-agent 内置 generate_diagram 工具, AI 可以在对话中自动生成 SVG 图表和流程图。')}

                {SECTION.title('触发方式')}
                {SECTION.desc('在对话中直接用自然语言请求, 例如:')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {[
                    '"帮我画一个系统架构图"',
                    '"生成一个用户登录流程图"',
                    '"画一个项目模块依赖关系图"',
                    '"用甘特图展示开发计划"',
                    '"画一个数据流图"',
                  ].map(q => (
                    <div key={q} style={{
                      padding: '4px 8px', borderRadius: 4,
                      background: 'var(--panel)', border: '1px solid var(--border)',
                      fontSize: 11, color: 'var(--accent)', fontFamily: 'monospace',
                    }}>
                      {q}
                    </div>
                  ))}
                </div>

                {SECTION.title('支持的图表类型')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { type: 'flowchart', name: '流程图', desc: '流程/决策/步骤图' },
                    { type: 'architecture', name: '架构图', desc: '系统/模块/组件图' },
                    { type: 'sequence', name: '时序图', desc: '交互/消息流图' },
                    { type: 'gantt', name: '甘特图', desc: '项目计划/时间线' },
                    { type: 'mindmap', name: '思维导图', desc: '知识/概念关系图' },
                  ].map(d => (
                    <div key={d.type} style={{
                      padding: '6px 8px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)' }}>
                        {SECTION.tag(d.type, 'purple')} {d.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{d.desc}</div>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('安全机制')}
                {SECTION.desc('图表生成采用双重安全消毒:')}
                {['后端: sanitizeSvg() 剥离危险标签和属性', '前端: DOMParser 解析后移除所有 on* 事件属性', 'SVG 在隔离环境中渲染, 不执行脚本'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}

                {SECTION.divider()}
                {SECTION.title('Goal 模式 (目标驱动)')}
                {SECTION.desc('AI 可以自动将复杂目标拆解为多阶段任务, 逐步验证执行:')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 12, fontFamily: 'monospace', fontSize: 11,
                  color: 'var(--fg-2)', whiteSpace: 'pre',
                }}>{`目标 → 拆解阶段 → 逐阶段执行 → 验证结果
  ↑                              │
  │    验证失败 → 自动修正 → 重试 │
  │                              ↓
  └──── 完成报告 ← 全部通过 ←───┘

硬性上限: 8阶段 / 2次重试 / 5min阶段超时 / 30min总超时`}</div>
              </div>
            ),
          },

          /* ====== 5. 快捷操作 ====== */
          {
            key: 'shortcuts',
            label: '快捷操作',
            children: (
              <div>
                {SECTION.title('斜杠命令')}
                {SECTION.desc('在对话框输入 / 触发斜杠命令菜单:')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { cmd: '/help', desc: '显示帮助信息' },
                    { cmd: '/clear', desc: '清空当前对话' },
                    { cmd: '/mode', desc: '切换运行模式' },
                    { cmd: '/model', desc: '切换模型' },
                    { cmd: '/skill', desc: '触发技能' },
                    { cmd: '/diagram', desc: '生成图表' },
                  ].map(c => (
                    <div key={c.cmd} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px' }}>
                      <code style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 3,
                        background: 'var(--panel)', border: '1px solid var(--border)',
                        fontFamily: 'monospace', color: 'var(--accent)',
                      }}>{c.cmd}</code>
                      <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{c.desc}</span>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('LLM 路由策略')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 12, fontFamily: 'monospace', fontSize: 11,
                  color: 'var(--fg-2)', whiteSpace: 'pre',
                }}>{`用户请求 → Cost Guard (费用检查)
    │
    ├─ 缓存命中? → 直接返回
    │
    ├─ 5维评分选择最优 Provider
    │   (质量/速度/成本/可用性/匹配度)
    │
    ├─ 失败降级 → 备选 Provider
    │
    └─ 熔断保护 → 暂停不可用 Provider`}</div>

                {SECTION.divider()}
                {SECTION.title('自主修复机制')}
                {SECTION.desc('AI 遇到错误时自动尝试 8 种修复模式:')}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {['缺模块', '编码错', '路径错', '权限', '语法', '网络', '工具', '解析'].map(m => (
                    <Tag key={m} style={{ fontSize: 10 }}>{m}</Tag>
                  ))}
                </div>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};
