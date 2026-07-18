/**
 * Onboarding Wizard - 首次启动引导 v3
 * 收集: 名称 → 行业选择 → 用例 → 知识问卷 → 密钥(可选)
 * 完成后写入 useProfileStore + localStorage 行业记忆
 * v3: 下拉预设选项 + 优化图标
 */
import React, { useState } from 'react';
import { Modal, Input, Button, Space, Typography, Radio, Card, Tag, message, Select, Progress, AutoComplete } from 'antd';
import {
  UserOutlined, RightOutlined, LeftOutlined,
  RocketOutlined, SmileOutlined, CodeOutlined, PictureOutlined,
  MessageOutlined, ShopOutlined, KeyOutlined, CheckCircleOutlined,
  ThunderboltOutlined, AppstoreOutlined, ExperimentOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { useProfileStore } from '../store';
import { useSessionStore } from '../store/sessionStore';
import { INDUSTRY_TEMPLATES } from '../services/IndustryTemplates';

const { Title, Paragraph, Text } = Typography;

interface OnboardProps {
  open: boolean;
  onClose?: () => void;
  onFinish?: (name: string) => void;
}

type Step = 'welcome' | 'name' | 'industry' | 'useCase' | 'questionnaire' | 'key' | 'done';

const USE_CASES = [
  { key: 'chat', label: '日常聊天', icon: <MessageOutlined />, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', desc: '问问题, 写文案, 翻译' },
  { key: 'image', label: '生图创作', icon: <PictureOutlined />, gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', desc: 'AI 画图, 封面, 头像' },
  { key: 'code', label: '写代码', icon: <CodeOutlined />, gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', desc: '调试, 重构, 解释' },
  { key: 'auto', label: '全自动', icon: <RocketOutlined />, gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', desc: 'Agent + 工具全开' },
];

const SUGGEST_NAMES = ['小明', 'Alex', 'Lisa', '张工', 'Sarah', '老王', '游客'];

// 问卷预设选项 (按行业)
const QUESTION_PRESETS: Record<string, string[][]> = {
  decoration: [
    ['家装', '工装', '两者都有'],
    ['业主', '设计师', '施工队', '建材商'],
    ['现代简约', '新中式', '欧式', '日式', '北欧', '混搭'],
    ['是, 需要详细报价', '简单估算即可', '暂时不需要'],
    ['是, 必须的', '有最好', '不需要'],
  ],
  comic: [
    ['漫画', '短剧', '动画', '图文小说'],
    ['抖音', 'B站', 'YouTube', '小红书', '微信公众号'],
    ['日系', '国风', '美漫', '韩漫', '赛博朋克'],
    ['是, 核心需求', '偶尔辅助', '不需要'],
    ['是, 很重要', '尽量保持', '无所谓'],
  ],
  ecommerce: [
    ['服装', '数码', '食品', '美妆', '家居', '其他'],
    ['淘宝/天猫', '抖音', '拼多多', '独立站', '多平台'],
    ['是, 批量生成', '少量即可', '不需要'],
    ['是, 急需', '有模板就行', '不需要'],
    ['高端品质', '平价亲民', '年轻潮流', '传统经典'],
  ],
  education: [
    ['语文/数学/英语', '编程/IT', '艺术/音乐', '职业培训', '其他'],
    ['录播课程', '直播教学', '图文教程', '混合模式'],
    ['K12学生', '大学生', '职场成人', '企业培训', '全年龄'],
    ['是, 核心需求', '偶尔需要', '不需要'],
    ['是, 必须的', '简单测试即可', '不需要'],
  ],
  realestate: [
    ['新房', '二手房', '租房', '商业地产'],
    ['住宅', '商业', '别墅', '公寓', '多类型'],
    ['是, 核心卖点', '有最好', '不需要'],
    ['是, 自动生成', '手动编辑', '不需要'],
    ['客户跟进', '房源管理', '数据分析', '全都要'],
  ],
  medical: [
    ['临床诊疗', '医美整形', '康复理疗', '中医养生', '其他'],
    ['是, 核心需求', '辅助参考', '不需要'],
    ['HIPAA标准', '个人信息保护法', '基本合规', '不了解'],
    ['是, 必须的', '简单记录即可', '不需要'],
  ],
  legal: [
    ['民事纠纷', '刑事辩护', '商事仲裁', '知识产权', '多领域'],
    ['是, 核心需求', '偶尔需要', '不需要'],
    ['个人', '中小企业', '大型企业', '政府机构'],
    ['是, 必须的', '简单检索即可', '不需要'],
  ],
};

const STEPS: Step[] = ['welcome', 'name', 'industry', 'useCase', 'questionnaire', 'key', 'done'];
const stepLabels: Record<Step, string> = {
  welcome: '欢迎', name: '名字', industry: '行业', useCase: '用例', questionnaire: '问卷', key: '密钥', done: '完成',
};

const DEV_OPTIONS = {
  languages: ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'PHP', 'Swift', 'Kotlin'],
  frontend: ['React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', '无'],
  backend: ['Express', 'Nest.js', 'FastAPI', 'Django', 'Spring', 'Gin', 'Actix', '无'],
  packageManager: ['pnpm', 'npm', 'yarn', 'bun', 'pip', 'cargo'],
  css: ['Tailwind CSS', 'CSS Modules', 'Ant Design', 'MUI', 'styled-components', 'SCSS', '无'],
};

export const Onboarding: React.FC<OnboardProps> = ({ open, onClose, onFinish }) => {
  const { setProfile } = useProfileStore();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [industryId, setIndustryId] = useState('general');
  const [useCase, setUseCase] = useState('chat');
  const [devPrefs, setDevPrefs] = useState<Record<string, string[]>>({
    languages: [], frontend: [], backend: [], packageManager: [], css: [],
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState('');
  const [skipKey, setSkipKey] = useState(false);

  const industry = INDUSTRY_TEMPLATES.find(t => t.id === industryId);
  const currentIdx = STEPS.indexOf(step);
  const pct = Math.round(((currentIdx + 1) / STEPS.length) * 100);

  const finish = () => {
    if (!name.trim()) { message.warning('写个名字吧'); return; }

    // 保存行业选择到 localStorage + zustand store
    const profileData = {
      name: name.trim(),
      onboardedAt: Date.now(),
      language: 'zh' as const,
      industry: industryId,
      useCase,
      devPrefs: showDevPrefs ? devPrefs : undefined,
      questionnaire: answers,
      industrySkills: industry?.requiredSkills || [],
    };
    setProfile(profileData);
    // 也存一份到 localStorage 方便后续读取
    localStorage.setItem('agentai.profile', JSON.stringify(profileData));
    // 存储问卷答案作为用户记忆
    if (Object.keys(answers).length > 0) {
      localStorage.setItem('agentai.memory.questionnaire', JSON.stringify({
        industry: industryId,
        answers,
        ts: Date.now(),
      }));
    }
    // 存储行业技能需求
    if (industry?.requiredSkills.length) {
      localStorage.setItem('agentai.industry.skills', JSON.stringify({
        industry: industryId,
        skills: industry.requiredSkills,
        ts: Date.now(),
      }));
    }

    // 同步完整身份到 gateway (非阻塞, 网络失败不影响本地)
    fetch(GATEWAY_HTTP + '/v1/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        industry: industryId,
        useCase,
        devPrefs: showDevPrefs ? devPrefs : undefined,
        questionnaire: answers,
        industrySkills: industry?.requiredSkills || [],
        onboardedAt: Date.now(),
      }),
    }).catch(() => {
      // 网络失败静默忽略, 下次 chat 请求会自动同步
    });

    // 保存到 localStorage 的历史用户记录 (agentai.user.${name})
    localStorage.setItem(`agentai.user.${name.trim()}`, JSON.stringify(profileData));
    // 同步到 sessionStore 的 currentUserId
    useSessionStore.getState().setCurrentUserId(name.trim());

    message.success(`欢迎, ${name.trim()}!`);
    setStep('done');
    if (onFinish) {
      onFinish(name.trim());
    } else {
      setTimeout(() => window.location.reload(), 1200);
    }
  };

  const saveKey = async () => {
    if (!apiKey.trim()) { setSkipKey(true); finish(); return; }
    try {
      const r = await fetch(GATEWAY_HTTP + '/v1/settings/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'agentai', apiKey }),
      });
      if (r.ok) { message.success('密钥已保存'); finish(); } else { message.error('保存失败'); finish(); }
    } catch { finish(); }
  };

  // 是否显示开发偏好（替代行业问卷）
  const showDevPrefs = industryId === 'developer';

  const nextStep = () => {
    const idx = STEPS.indexOf(step);
    // general 行业: 跳过问卷
    if (step === 'useCase' && industryId === 'general') {
      setStep('key'); return;
    }
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]!);
  };
  const prevStep = () => {
    const idx = STEPS.indexOf(step);
    if (step === 'key' && industryId === 'general') {
      setStep('useCase'); return;
    }
    if (idx > 0) setStep(STEPS[idx - 1]!);
  };

  return (
    <Modal open={open} footer={null} closable={false} maskClosable={false} width={560} centered styles={{ body: { padding: 0 } }}>
      {/* Progress */}
      {step !== 'welcome' && step !== 'done' && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{currentIdx}/{STEPS.length - 2}</span>
          <Progress percent={pct} size="small" strokeColor="var(--accent)" trailColor="var(--border)" style={{ flex: 1, margin: 0 }} />
        </div>
      )}

      {/* Welcome — 工作台风格, 去AI味 */}
      {step === 'welcome' && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: 16, margin: '0 auto',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <img
              src="/favicon-192.png"
              alt="Atlas"
              style={{ width: 64, height: 64 }}
            />
          </div>
          <Title level={2} style={{ marginTop: 24, color: 'var(--fg)', fontWeight: 600, letterSpacing: '-0.02em' }}>配置你的工作台</Title>
          <Paragraph style={{ color: 'var(--muted-2)', fontSize: 14, margin: '8px 0', lineHeight: 1.6 }}>
            几步设置，让 <strong style={{ color: 'var(--fg)' }}>PulseFlow</strong> 了解你的工作方式<br />行业技能和记忆会自动适配
          </Paragraph>
          <div style={{ marginTop: 28 }}>
            <Button type="primary" size="large" shape="round" icon={<RightOutlined />} onClick={nextStep}
              style={{ height: 44, paddingInline: 36, fontSize: 14, background: 'var(--accent)', borderColor: 'var(--accent)' }}>
              开始配置
            </Button>
          </div>
          <div style={{ marginTop: 20, color: 'var(--muted)', fontSize: 11 }}>数据存本机 · 无需联网 · 开源 Apache 2.0</div>
        </div>
      )}

      {/* Name — AutoComplete: 可输入+可选择 */}
      {step === 'name' && (
        <div style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <UserOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
            </div>
            <Title level={3} style={{ margin: 0 }}>你的称呼</Title>
          </div>
          <AutoComplete
            size="large"
            options={SUGGEST_NAMES.map(n => ({ value: n }))}
            placeholder="输入或选择名字"
            value={name}
            onChange={(v: string) => setName(v)}
            filterOption={(input, option) => (option?.value as string)?.toLowerCase().includes(input.toLowerCase())}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>直接输入自定义名字, 或从下拉选择</Text>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={prevStep}>上一步</Button>
            <Button type="primary" disabled={!name.trim()} onClick={nextStep}>下一步</Button>
          </div>
        </div>
      )}

      {/* Industry — 系统风格图标 */}
      {step === 'industry' && (
        <div style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShopOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
            </div>
            <Title level={3} style={{ margin: 0 }}>选择行业</Title>
          </div>
          <Paragraph style={{ color: 'var(--muted-2)', marginLeft: 50 }}>系统会自动加载行业技能和知识适配</Paragraph>
          <Radio.Group value={industryId} onChange={e => setIndustryId(e.target.value)} style={{ width: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {INDUSTRY_TEMPLATES.map(t => (
                <Card key={t.id} hoverable size="small" onClick={() => setIndustryId(t.id)}
                  style={{
                    border: industryId === t.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: industryId === t.id ? 'rgba(99,102,241,0.15)' : 'var(--card)',
                    borderRadius: 10,
                    boxShadow: industryId === t.id ? '0 0 8px rgba(99,102,241,0.25)' : 'none',
                    transition: 'all 0.2s ease',
                  }}>
                  <Radio value={t.id} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Space>
                      <span style={{ fontSize: 22 }}>{t.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{t.description}</div>
                        {t.requiredSkills.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {t.requiredSkills.map(s => <Tag key={s} color="purple" style={{ fontSize: 9, marginRight: 2 }}>{s}</Tag>)}
                          </div>
                        )}
                      </div>
                    </Space>
                    {industryId === t.id && (
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--accent)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                      }}>✓</span>
                    )}
                  </div>
                </Card>
              ))}
            </Space>
          </Radio.Group>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={prevStep}>上一步</Button>
            <Button type="primary" onClick={nextStep}>下一步</Button>
          </div>
        </div>
      )}

      {/* UseCase — 系统风格图标 */}
      {step === 'useCase' && (
        <div style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AppstoreOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
            </div>
            <Title level={3} style={{ margin: 0 }}>主要用途</Title>
          </div>
          <Radio.Group value={useCase} onChange={e => setUseCase(e.target.value)} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {USE_CASES.map(uc => (
                <Card key={uc.key} hoverable size="small" onClick={() => setUseCase(uc.key)}
                  style={{
                    border: useCase === uc.key ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: useCase === uc.key ? 'var(--card-active, rgba(79,70,229,0.08))' : 'var(--card)',
                    borderRadius: 10, cursor: 'pointer',
                  }}>
                  <Radio value={uc.key} style={{ display: 'none' }} />
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 14, margin: '0 auto 8px',
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {React.cloneElement(uc.icon as React.ReactElement, { style: { fontSize: 22, color: 'var(--fg)' } })}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>{uc.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>{uc.desc}</div>
                  </div>
                </Card>
              ))}
            </div>
          </Radio.Group>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={prevStep}>上一步</Button>
            <Button type="primary" onClick={nextStep}>下一步</Button>
          </div>
        </div>
      )}

      {/* Questionnaire — 行业问卷 / 开发者偏好 */}
      {step === 'questionnaire' && (
        <div style={{ padding: 32 }}>
          {showDevPrefs ? (
            /* 开发者行业: 显示开发偏好 */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CodeOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
                </div>
                <Title level={3} style={{ margin: 0 }}>开发偏好</Title>
              </div>
              <Paragraph style={{ color: 'var(--muted-2)', marginLeft: 46 }}>AI 会根据你的技术栈生成匹配的代码风格</Paragraph>
              {Object.entries(DEV_OPTIONS).map(([category, options]) => {
                const labels: Record<string, string> = {
                  languages: '编程语言', frontend: '前端框架', backend: '后端框架',
                  packageManager: '包管理器', css: 'CSS 方案',
                };
                const selected = devPrefs[category] || [];
                return (
                  <div key={category} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>
                      {labels[category] || category}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {options.map(opt => {
                        const isSelected = selected.includes(opt);
                        return (
                          <button
                            key={opt}
                            onClick={() => {
                              setDevPrefs(prev => ({
                                ...prev,
                                [category]: isSelected
                                  ? prev[category].filter(v => v !== opt)
                                  : [...prev[category], opt],
                              }));
                            }}
                            style={{
                              padding: '4px 12px', borderRadius: 16, fontSize: 12,
                              border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                              background: isSelected ? 'rgba(99,102,241,0.15)' : 'var(--card)',
                              color: isSelected ? 'var(--accent)' : 'var(--fg-2)',
                              cursor: 'pointer', fontWeight: isSelected ? 600 : 400,
                              transition: 'all 0.15s',
                              boxShadow: isSelected ? '0 0 6px rgba(99,102,241,0.2)' : 'none',
                            }}
                          >
                            {isSelected && '✓ '}{opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : industry && industry.knowledgeQuestions.length > 0 ? (
            /* 其他行业: 显示行业问卷 */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <ExperimentOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
                </div>
                <Title level={3} style={{ margin: 0 }}>{industry.label} 知识问卷</Title>
              </div>
              <Paragraph style={{ color: 'var(--muted-2)', marginLeft: 50 }}>帮助系统了解你的专业背景</Paragraph>
              <Space direction="vertical" style={{ width: '100%' }} size={14}>
                {industry.knowledgeQuestions.map((q, i) => {
                  const presets = QUESTION_PRESETS[industryId]?.[i];
                  return (
                    <div key={i}>
                      <Text style={{ fontSize: 13, color: '#ccc', display: 'block', marginBottom: 6 }}>{q}</Text>
                      {presets && presets.length > 0 ? (
                        <AutoComplete
                          size="middle"
                          options={presets.map(p => ({ value: p }))}
                          placeholder="选择或输入答案..."
                          value={answers[`q${i}`] || ''}
                          onChange={(v: string) => setAnswers(prev => ({ ...prev, [`q${i}`]: v }))}
                          filterOption={(input, option) => (option?.value as string)?.toLowerCase().includes(input.toLowerCase())}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <Input
                          placeholder="你的答案..."
                          value={answers[`q${i}`] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [`q${i}`]: e.target.value }))}
                          size="middle"
                        />
                      )}
                    </div>
                  );
                })}
              </Space>
            </>
          ) : null}
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={prevStep}>上一步</Button>
            <Space>
              <Button onClick={() => setStep('key')}>跳过</Button>
              <Button type="primary" onClick={nextStep}>下一步</Button>
            </Space>
          </div>
        </div>
      )}

      {/* Key */}
      {step === 'key' && (
        <div style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <KeyOutlined style={{ fontSize: 18, color: 'var(--fg)' }} />
            </div>
            <Title level={3} style={{ margin: 0 }}>接入密钥 (可选)</Title>
          </div>
          <Paragraph style={{ color: 'var(--muted-2)' }}>
            推荐 <a href="https://agnes-ai.com" target="_blank" style={{ color: 'var(--accent)' }}>Agnes AI</a> 免费 key (RPM 20 内永久免费)
          </Paragraph>
          <Input.Password size="large" placeholder="sk-... (留空跳过)" value={apiKey}
            onChange={e => setApiKey(e.target.value)} />
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11 }}>AES-256-GCM 加密存本机</div>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <Button onClick={prevStep}>上一步</Button>
            <Space>
              <Button onClick={() => { setSkipKey(true); finish(); }}>跳过</Button>
              <Button type="primary" onClick={saveKey}>{apiKey.trim() ? '保存并完成' : '完成'}</Button>
            </Space>
          </div>
        </div>
      )}

      {/* Done — 工作台就绪 */}
      {step === 'done' && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: 16, margin: '0 auto',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CheckCircleOutlined style={{ fontSize: 36, color: 'var(--accent)' }} />
          </div>
          <Title level={2} style={{ marginTop: 24, color: 'var(--fg)', fontWeight: 600 }}>{name}, 工作台已就绪</Title>
          {industry && industryId !== 'general' && <Tag color="purple" style={{ marginBottom: 8 }}>{industry.icon} {industry.label}</Tag>}
          <Paragraph style={{ color: 'var(--muted-2)' }}>正在加载主界面...</Paragraph>
          <Tag color="green">加载中...</Tag>
        </div>
      )}
    </Modal>
  );
};
