/**
 * GuideModal — 使用指南弹窗
 * --------------------------------------------------
 * 完整的系统架构说明、UI 功能描述、图表触发说明
 */
import React from 'react';
import { Modal, Tabs, Tag } from 'antd';
import { CloseOutlined, BookOutlined, AppstoreOutlined, ThunderboltOutlined, PictureOutlined, CodeOutlined, TeamOutlined } from '@ant-design/icons';

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
          <span>岐枢 PulseFlow 使用指南</span>
          <Tag color="purple" style={{ fontSize: 9 }}>v0.5.0</Tag>
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
                {SECTION.title('岐枢是什么?')}
                {SECTION.desc('岐枢 (PulseFlow) 是一个多模型 AI 平台，支持智能对话、代码编辑、图像生成、视频生成、写作等功能。采用 Gateway + GUI 分离架构，Gateway 提供 LLM 路由、工具调用、记忆管理，GUI 提供交互界面。')}

                {SECTION.title('系统架构')}
                {/* 架构图用文本流程图表示 */}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 16, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8,
                  color: 'var(--fg-2)', whiteSpace: 'pre', overflowX: 'auto',
                }}>{`┌─────────────────────────────────────────────────────────┐
│              岐枢 PulseFlow                       │
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
                    { name: 'PulseFlow Loop', desc: '主循环: LLM调用→工具分派→结果入log→继续循环', tag: 'gateway' },
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

          /* ====== 4. AI 高级能力 (团队协作/3D场景/公网分享) ====== */
          {
            key: 'advanced',
            label: 'AI 高级能力',
            children: (
              <div>
                {SECTION.title('🎭 AI 团队协作 (run_team)')}
                {SECTION.desc('启动预设 AI 团队执行复杂任务。团队由多个角色 Agent 组成, 支持并行/串行/审查三种工作流, 结果自动综合。')}
                {SECTION.divider()}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { id: 'code-review', name: '代码审查团队', members: '架构师 + 安全专家 + 性能专家', flow: '并行', cases: '提交前审查 / 架构评估 / 技术债务排查' },
                    { id: 'feature-dev', name: '功能开发团队', members: '架构师 + 前端 + 后端 + 测试', flow: '串行', cases: '全栈功能开发 / 端到端实现' },
                    { id: 'docs', name: '文档团队', members: '技术写作 + 校对', flow: '串行', cases: 'API文档 / 技术规范 / 用户手册' },
                    { id: 'debug', name: '调试团队', members: '探索 + 审查 + 安全', flow: '并行', cases: '复杂Bug定位 / 性能调优' },
                    { id: 'security-audit', name: '安全审计团队', members: '漏洞扫描 + 架构安全 + 代码探索', flow: '并行', cases: '上线前审计 / 合规检查' },
                    { id: 'refactor', name: '重构团队', members: '架构师 + 前端 + 后端 + 测试', flow: '串行', cases: '系统重构 / 代码现代化' },
                  ].map(t => (
                    <div key={t.id} style={{
                      padding: '8px 10px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <TeamOutlined style={{ fontSize: 12, color: 'var(--accent)' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{t.name}</span>
                        {SECTION.tag(t.flow, t.flow === '并行' ? 'green' : 'blue')}
                        <code style={{ fontSize: 10, padding: '1px 4px', background: 'var(--panel)', borderRadius: 3, color: 'var(--muted)' }}>{t.id}</code>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>成员: {t.members}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>适用: {t.cases}</div>
                    </div>
                  ))}
                </div>
                {SECTION.divider()}
                {SECTION.title('使用方法')}
                {SECTION.desc('直接在对话中描述任务, AI 会自动判断是否需要启动团队。也可手动触发:')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 8,
                }}>用户: "帮我审查整个 packages 目录的代码质量"<br/>AI: → 自动调用 run_team({'{teamId:"code-review", task:"..."}'})</div>
                {SECTION.desc('或显式指令:')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)',
                }}>用户: "用代码审查团队审查 src/auth 目录"<br/>用户: "组建功能开发团队实现用户登录模块"</div>

                {SECTION.divider()}
                {SECTION.title('🎲 AI 生成 3D 可交互场景 (generate_3d_scene)')}
                {SECTION.desc('根据用户描述生成 Three.js 参数化 3D 场景, 前端自动渲染为可交互预览。用户可旋转/缩放/调参/下载。')}
                {SECTION.title('适用场景')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                  {[
                    { icon: '🪑', name: '家具设计', desc: '沙发/桌椅/灯具 3D 预览' },
                    { icon: '🏗️', name: '建筑可视化', desc: '楼盘/室内/外观 3D 漫游' },
                    { icon: '📦', name: '产品原型', desc: '包装/工业品 3D 展示' },
                    { icon: '📊', name: '数据可视化', desc: '3D 柱状图/散点/曲面' },
                    { icon: '🎮', name: '游戏场景', desc: '低多边形场景概念图' },
                    { icon: '🎨', name: '艺术创作', desc: '抽象雕塑/粒子系统' },
                  ].map(s => (
                    <div key={s.name} style={{
                      padding: '6px 8px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
                        <span style={{ marginRight: 4 }}>{s.icon}</span>{s.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>{s.desc}</div>
                    </div>
                  ))}
                </div>
                {SECTION.title('使用示例')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)',
                }}>用户: "生成一个 3D 沙发, 可以旋转看"<br/>用户: "用 3D 场景展示一个装修客厅效果"<br/>用户: "画一个数据可视化 3D 柱状图"</div>
                {SECTION.desc('生成后可在对话区交互预览, 支持刷新/下载 HTML/全屏查看。')}

                {SECTION.divider()}
                {SECTION.title('🌐 公网分享本地端口 (share_port)')}
                {SECTION.desc('将本地端口通过 localtunnel 隧道暴露为公网 URL, 任何人访问该 URL 都会转发到你的 localhost。无需注册, 完全免费。')}
                {SECTION.title('触发方式')}
                {SECTION.desc('AI 会在以下场景主动询问是否需要公网分享:')}
                {['启动了 vite dev / pnpm dev / npm start 等本地服务', '完成 Web 项目开发', '用户提到"演示/分享给/远程访问/外网访问"', '完成 Webhook/回调类功能'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}
                {SECTION.title('使用示例')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 8,
                }}>用户: "把 localhost:3000 分享出去"<br/>AI: → share_port({'{action:"create", port:3000}'}) → https://xxx.loca.lt</div>
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)',
                }}>用户: "查看所有隧道" → share_port({'{action:"list"}'})<br/>用户: "关闭隧道" → share_port({'{action:"close", tunnel_id:"tun_xxx"}'})</div>
                {SECTION.divider()}
                {SECTION.title('安全规则')}
                {['仅 1024-65535 端口 (拒绝系统端口)', '拒绝 22/3389 等敏感端口', '不主动为数据库端口 (3306/5432/6379) 创建隧道', '隧道 URL 仅返回给当前用户, 不写入日志'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}

                {SECTION.divider()}
                {SECTION.title('📦 依赖自管理 (npm_install + ensure_dependency)')}
                {SECTION.desc('AI 可以自动检测和安装缺失的依赖包，支持 npm/pnpm/yarn/pip 多种包管理器。')}
                {SECTION.title('触发方式')}
                {SECTION.desc('AI 会在以下场景主动安装依赖:')}
                {['运行项目前自动检查关键依赖', '调用工具前发现可能缺包', '遇到 "Cannot find module" 错误时自动修复', '新接手项目探索时检查 package.json 依赖'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}
                {SECTION.title('使用示例')}
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 8,
                }}>用户: "运行这个项目"<br/>AI: → 自动调用 ensure_dependency 检查并安装依赖 → 启动项目</div>
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)',
                }}>用户: "帮我安装 axios"<br/>AI: → npm_install({'{package:"axios"}'})</div>
                {SECTION.divider()}
                {SECTION.title('智能特性')}
                {['自动检测包管理器 (pnpm > yarn > npm)', '支持 monorepo workspace 安装', '幂等检查: 已安装则跳过', '国内镜像加速 (npmmirror/清华源)', 'Python venv 自动检测'].map(t => (
                  <div key={t} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    • {t}
                  </div>
                ))}
              </div>
            ),
          },

          /* ====== 5. 图表与流程图 ====== */
          {
            key: 'diagrams',
            label: '图表/流程图',
            children: (
              <div>
                {SECTION.title('AI 生成图表功能')}
                {SECTION.desc('岐枢内置 generate_diagram 工具, AI 可以在对话中自动生成 SVG 图表和流程图。')}

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

          /* ====== 6. API Key 获取 ====== */
          {
            key: 'apikeys',
            label: 'API Key 获取',
            children: (
              <div>
                {SECTION.title('各模型 API Key 获取方式')}
                {SECTION.desc('点击链接跳转官网注册，然后在 ATLAS 设置页粘贴 Key 即可')}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { name: '岐枢 (Agnes)', url: 'https://api.agnes-ai.cn', quota: '每月 1000 次对话 + 100 张生图', env: 'AGENTAI_API_KEY' },
                    { name: '智谱 GLM', url: 'https://open.bigmodel.cn', quota: '新用户 500 万 tokens', env: 'ZHIPU_API_KEY' },
                    { name: 'DeepSeek', url: 'https://platform.deepseek.com', quota: '新用户 5000 万 tokens', env: 'DEEPSEEK_API_KEY' },
                    { name: 'OpenAI', url: 'https://platform.openai.com', quota: '需绑定信用卡', env: 'OPENAI_API_KEY' },
                    // NVIDIA NIM 已移除 (2026-07-25): NIM 不可用
                    { name: '商汤 SenseNova', url: 'https://platform.sensenova.cn', quota: '每 5 小时 1500 次', env: 'SENSENOVA_API_KEY' },
                    { name: '美团 LongCat', url: 'https://longcat.chat', quota: '申请内测资格', env: 'LONGCAT_API_KEY' },
                    { name: 'SuperAPI', url: 'https://superapi.vanguard.dpdns.org', quota: '联系管理员', env: 'SUPERAPI_API_KEY' },
                    { name: '通义千问', url: 'https://dashscope.aliyun.com', quota: '新用户免费额度', env: 'QWEN_API_KEY' },
                    { name: 'Moonshot', url: 'https://platform.moonshot.cn', quota: '新用户 15 元额度', env: 'MOONSHOT_API_KEY' },
                    { name: 'MiniMax', url: 'https://platform.minimaxi.com', quota: '新用户免费额度', env: 'MINIMAX_API_KEY' },
                  ].map(m => (
                    <div key={m.name} style={{
                      padding: '10px 12px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</span>
                        <a 
                          href={m.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: 'var(--accent)' }}
                        >
                          去获取 →
                        </a>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                        免费额度: {m.quota} · 环境变量: {SECTION.code(m.env)}
                      </div>
                    </div>
                  ))}
                </div>

                {SECTION.divider()}
                {SECTION.title('使用步骤')}
                {['1. 点击上方链接访问官网', '2. 注册账号并创建 API Key', '3. 复制 Key 到 ATLAS 设置页', '4. 点击"测试连接"验证', '5. 启用模型即可使用'].map((t, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--fg-2)', padding: '2px 0', paddingLeft: 8 }}>
                    {t}
                  </div>
                ))}
              </div>
            ),
          },

          /* ====== 7. 快捷操作 ====== */
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
