/**
 * 真设置页 - 密钥管理 / 免费模型 / 商用模型 / 启动 wizard 入口
 */
import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Space, Tag, Alert, Form, message, Tabs, Descriptions, Select, Divider, Modal, Switch, Typography, Collapse, Tooltip, Table, App, Progress } from 'antd';
import { saveApiKey, getApiKey, removeApiKey } from '../services/secureKeyStorage';
import { KeyOutlined, SaveOutlined, ApiOutlined, SettingOutlined, ThunderboltOutlined, RobotOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, DeleteOutlined, BellOutlined, SoundOutlined, AppstoreOutlined, SecurityScanOutlined, CheckOutlined, LinkOutlined, CrownOutlined, ExperimentOutlined, PartitionOutlined, SyncOutlined, InfoCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { ModelSelector } from './ModelSelector';
import { SandboxRulesEditor } from './SandboxRulesEditor';
import { EvolutionPanel } from './EvolutionPanel';
import MCPConfigModal from './mcp/MCPConfigModal';
import { useSettingsStore, useFrameworkStore } from '../store';
import { useModelStore, type ModelConfig } from '../store/modelStore';
import { useModeStore, MODE_CONFIG, MODE_ORDER, type AppMode } from '../store/modeStore';
import { taskNotifier } from '../services/TaskNotifier';
import { setTtsEnabled, isTtsEnabled } from '../services/VoiceService';
import { VoiceSelector } from './VoiceSelector';

const { Text } = Typography;
const httpUrl = () => GATEWAY_HTTP;

/**
 * UpdaterPanel — Tauri 应用内自动更新 UI
 *  ════════════════════════════════════════════════════════════
 *   2 条触发路径:
 *    ① 设置 → 自动更新 Tab → 用户主动点「检查更新」
 *    ② 启动 8s 后台静默检查 → 发现新版本 → 发系统通知 → 引导用户到此 Tab
 *   运行时:
 *    - Tauri 桌面环境: 调 invoke('plugin:updater|check') 等标准命令
 *    - Web 开发环境: 降级为仅显示提示, 不执行更新
 *  ════════════════════════════════════════════════════════════
 */
const UpdaterPanel: React.FC = () => {
  const { message: messageApi } = App.useApp();
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState<string>(__APP_VERSION__ || '0.1.0');
  const [latest, setLatest] = useState<{
    version: string; date: string; body?: string; bytes?: number;
  } | null>(null);
  const [error, setError] = useState<string>('');

  const isTauriDesktop = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
    || typeof (window as any).__TAURI__ !== 'undefined';

  const handleCheck = async () => {
    setChecking(true);
    setError('');
    setLatest(null);
    try {
      if (!isTauriDesktop) {
        // Web 环境: 手动去 GitHub Release 页比较
        const mock = await new Promise<{ version: string; date: string }>(r => setTimeout(() => r({
          version: '0.1.0', date: new Date().toISOString().slice(0, 10),
        }), 700));
        if (mock.version !== current) setLatest(mock);
        else messageApi.info(`当前已是最新版本 v${current} (开发环境, 未调用 Tauri Updater)`);
        setChecking(false);
        return;
      }
      // Tauri Updater standard commands (plugin-updater v2)
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        const updater = await (window as any).__TAURI__?.updater?.check?.()
          || await invoke('plugin:updater|check');
        if (updater && updater.shouldUpdate) {
          setLatest({
            version: updater.manifest?.version || updater.latestVersion || '',
            date: updater.manifest?.date || updater.pubDate || new Date().toISOString().slice(0, 10),
            body: updater.manifest?.body,
            bytes: updater.contentLength || updater.manifest?.bytes,
          });
          messageApi.success(`发现新版本 v${updater.latestVersion}!`);
        } else {
          messageApi.success(`当前已是最新版本 v${current}`);
        }
      } catch (e: any) {
        throw new Error(e?.message || 'Updater 调用失败, 请确认 tauri-plugin-updater 已在 Cargo.toml 启用');
      }
    } catch (e: any) {
      setError(e?.message || '检查失败');
      messageApi.error(e?.message || '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    setDownloading(true);
    setProgress(5);
    const hide = messageApi.loading('正在下载安装包...', 0);
    try {
      if (!isTauriDesktop) {
        for (let i = 10; i <= 100; i += 15) { await new Promise(r => setTimeout(r, 300)); setProgress(i); }
        hide();
        Modal.confirm({
          title: '开发环境模拟完成',
          icon: <InfoCircleOutlined />,
          content: (<div>
            <div>真实桌面端将在这里执行: nsis .exe 下载 → 校验 .sig → 静默安装 → 自动重启</div>
            <div style={{ marginTop: 8 }}>当前为 Web 环境, 请手动下载: <a href="https://github.com/PulseFlowAI/pulseflow-platform/releases/latest" target="_blank" rel="noreferrer">GitHub Release</a></div>
          </div>),
        });
        return;
      }
      const { invoke } = await import('@tauri-apps/api/core');
      const onChunk = (_: any) => setProgress(p => Math.min(95, p + 2));
      try {
        // 走 tauri-plugin-updater 标准: download → wait → install-and-restart
        await invoke('plugin:updater|download_and_install', {
          onEvent: (_evt: any) => {}
        });
        // 兜底: 如果上面命令不存在 (旧版 plugin 命名差异), 直接用 window.__TAURI__.updater API
      } catch {
        const t: any = (window as any).__TAURI__;
        if (t?.updater?.install) await t.updater.install();
      }
      hide();
      messageApi.success('下载完成, PulseFlow 将在安装完成后自动重启');
    } catch (e: any) {
      hide();
      setError(e?.message || '下载/安装失败');
      messageApi.error(e?.message || '安装失败');
    } finally {
      setProgress(100);
      setDownloading(false);
    }
  };

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }} size={14}>
        <Alert
          type={isTauriDesktop ? 'info' : 'warning'}
          showIcon
          message={isTauriDesktop ? '应用内自动更新已启用' : '开发模式 (Web)'}
          description={isTauriDesktop
            ? '推送 Git tag v* 后, GitHub Actions 自动打包 + 生成签名。每次启动 8 秒后静默检查更新, 发现新版本会弹系统通知。'
            : 'Web 预览环境不执行 Updater 命令。请打包为桌面安装包 (.exe/.dmg/.AppImage) 后体验自动更新。'}
        />
        <Descriptions column={2} bordered size="small" style={{ marginTop: 4 }}>
          <Descriptions.Item label="当前版本">
            <Tag color="blue">v{current}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Updater Endpoint">
            <Text code style={{ fontSize: 11, userSelect: 'all' }}>
              github.com/PulseFlowAI/pulseflow-platform/releases/latest/download/latest.json
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="启动检查">
            <Tag color="green">✅ 每次启动 8s 后台静默</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="签名方式">
            <Tag color="purple">Ed25519 (Tauri signer)</Tag>
          </Descriptions.Item>
        </Descriptions>

        {latest && (
          <Alert
            type="success"
            showIcon
            icon={<SyncOutlined />}
            message={`发现新版本 v${latest.version}${latest.bytes ? ` (${Math.round(latest.bytes / 1048576)} MB)` : ''}`}
            description={
              <div>
                <div>发布日期: {String(latest.date).slice(0, 10)}</div>
                {latest.body && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.88 }}>{latest.body}</div>}
              </div>
            }
            style={{ marginTop: 6 }}
            action={
              <Button
                type="primary"
                size="middle"
                icon={<DownloadOutlined />}
                loading={downloading}
                onClick={handleInstall}
              >
                {downloading ? `下载中 ${progress}%` : '立即安装'}
              </Button>
            }
          />
        )}

        {downloading && (
          <Progress percent={progress} status="active" strokeColor={{ from: '#10B981', to: '#3B82F6' }} style={{ marginBottom: 8 }} />
        )}

        {error && (
          <Alert type="error" showIcon message="更新失败" description={<span style={{ fontSize: 12 }}>{error}</span>} closable />
        )}

        <Space wrap>
          <Button type="primary" icon={<SyncOutlined />} onClick={handleCheck} loading={checking}>
            检查更新
          </Button>
          <Button icon={<LinkOutlined />} onClick={() => window.open('https://github.com/PulseFlowAI/pulseflow-platform/releases', '_blank')}>
            打开发布页
          </Button>
          <Button
            danger
            icon={<InfoCircleOutlined />}
            onClick={() => Modal.info({
              title: 'Updater 配置指南（仅发布工程师）',
              icon: <InfoCircleOutlined />,
              width: 680,
              content: (
                <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 13 }}>
                  <li>本地生成密钥 (只需执行一次): <code>cd packages/agentai-desktop && pnpm tauri signer generate -w ~/.tauri/pulseflow.key</code></li>
                  <li>把输出的公钥 <code>-----BEGIN PUBLIC KEY-----....</code> 填入 <code>tauri.conf.json → plugins.updater.pubkey</code></li>
                  <li>GitHub Repo → Settings → Secrets and Variables → Actions → 新建 3 个 Repository Secrets:
                    <ul style={{ marginTop: 4 }}>
                      <li><code>TAURI_SIGNING_PRIVATE_KEY</code>: 上一步生成的私钥 PEM 内容 (含 BEGIN/END)</li>
                      <li><code>TAURI_SIGNING_PUBLIC_KEY</code>: 公钥 (可选, latest.json 中回显)</li>
                      <li><code>TAURI_KEY_PASSWORD</code>: 私钥密码 (若创建时没设置则留空)</li>
                    </ul>
                  </li>
                  <li>打 tag 推送: <code>git tag v0.2.0 &amp;&amp; git push --tags</code></li>
                  <li>Actions → Release Desktop 跑完 → Release 草稿生成 <code>latest.json</code> → 人工验证 → Publish release</li>
                </ol>
              ),
            })}
          >
            配置说明
          </Button>
        </Space>
      </Space>
    </Card>
  );
};

// ===== 商用模型预配置模板 =====
interface ModelTemplate {
  id: string;
  label: string;
  baseURL: string;
  models: string[];
  docsUrl: string;
  color: string;
  contextWindow: number;
  /** 在 modelStore 中与该模板共用同一密钥的其他 model id (例: deepseek → deepseek-pro) */
  extraModelIds?: string[];
}

const MODEL_TEMPLATES: ModelTemplate[] = [
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], docsUrl: 'https://platform.deepseek.com/api-keys', color: '#10B981', contextWindow: 1000000, extraModelIds: ['deepseek-pro'] },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], docsUrl: 'https://platform.openai.com/api-keys', color: '#F59E0B', contextWindow: 128000 },
  { id: 'qwen', label: '通义千问 (阿里云)', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'], docsUrl: 'https://help.aliyun.com/zh/dashscope', color: '#FF6A00', contextWindow: 128000 },
  { id: 'moonshot', label: '月之暗面 Moonshot', baseURL: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3'], docsUrl: 'https://platform.moonshot.cn/console/api-keys', color: '#6466F1', contextWindow: 128000 },
  { id: 'yi', label: '零一万物 Yi', baseURL: 'https://api.lingyiwanwu.com/v1', models: ['yi-lightning', 'yi-medium', 'yi-large'], docsUrl: 'https://platform.lingyiwanwu.com', color: '#8B5CF6', contextWindow: 128000 },
  { id: 'baichuan', label: '百川智能', baseURL: 'https://api.baichuan-ai.com/v1', models: ['Baichuan4', 'Baichuan3-Turbo'], docsUrl: 'https://platform.baichuan-ai.com', color: '#EC4899', contextWindow: 128000 },
  { id: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', models: ['MiniMax-M3'], docsUrl: 'https://platform.minimaxi.com', color: '#06B6D4', contextWindow: 128000 },
  { id: 'anthropic', label: 'Anthropic Claude', baseURL: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-haiku-3-5-20241022'], docsUrl: 'https://console.anthropic.com/', color: '#D97706', contextWindow: 200000 },
  { id: 'sensenova', label: '商汤 SenseNova (免费额度)', baseURL: 'https://token.sensenova.cn/v1', models: ['sensenova-6.7-flash-lite', 'sensenova-u1-fast', 'deepseek-v4-flash', 'glm-5.2'], docsUrl: 'https://platform.sensenova.cn/', color: '#2563EB', contextWindow: 262144 },
  { id: 'longcat', label: '美团 LongCat (免费额度)', baseURL: 'https://api.longcat.chat/openai', models: ['LongCat-2.0'], docsUrl: 'https://longcat.chat/', color: '#FFD700', contextWindow: 1000000 },
  // NVIDIA NIM 已移除 (2026-07-25): 需自建 GPU Docker + 端点不稳定 + 中国大陆不可达
];

// ===== SuperAPI 模型工厂 - 模型列表及定价 =====
interface SuperAPIModel {
  id: string;
  label: string;
  color: string;
  priceIn: string;
  priceOut: string;
  priceCache?: string;
  level?: string;
}
const SUPERAPI_MODEL_LIST: SuperAPIModel[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', color: '#10B981', priceIn: '0.51', priceOut: '1', level: 'default' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', color: '#059669', priceIn: '1.65', priceOut: '3.36', priceCache: '0.025', level: 'vvip' },
  { id: 'glm-5.2', label: 'GLM-5.2 (智谱)', color: '#3B82F6', priceIn: '1.25', priceOut: '5.68', level: 'svip' },
  { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus (千问)', color: '#FF6A00', priceIn: '1.3072', priceOut: '6.192', level: 'default' },
  { id: 'qwen3.7-max', label: 'Qwen3.7 Max (千问)', color: '#E65100', priceIn: '3.88', priceOut: '8.88', priceCache: '0.12', level: 'default' },
  { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus (千问)', color: '#FF8F00', priceIn: '1.1696', priceOut: '5.504', level: 'vvip' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', color: '#6466F1', priceIn: '1.25', priceOut: '5.68', level: 'vvip' },
  { id: 'grok-4.3', label: 'Grok 4.3 (xAI)', color: '#EC4899', priceIn: '0.6', priceOut: '1', priceCache: '0.12', level: 'default' },
  { id: 'doubao-seed-2.0-pro', label: '豆包 Seed 2.0 Pro', color: '#06B6D4', priceIn: '0.3', priceOut: '0.9', level: 'svip' },
  { id: 'step-3.7-flash', label: 'Step 3.7 Flash (阶跃)', color: '#8B5CF6', priceIn: '0.11', priceOut: '0.3', level: 'vip' },
  { id: 'mimo-v2.5-pro', label: 'Mimo V2.5 Pro', color: '#F97316', priceIn: '2.064', priceOut: '4.816', priceCache: '0.0344', level: 'vip' },
  { id: 'MiniMax-M3', label: 'MiniMax M3', color: '#14B8A6', priceIn: '0.24', priceOut: '0.8', level: 'default' },
];

// ===== 免费模型内置列表 =====
const FREE_MODELS = [
  { id: 'agentai', label: 'ALTES | 岐黄 Free (Flash)', envVar: 'AGENTAI_API_KEY', baseURL: 'https://api.agnes-ai.cn/v1', color: '#4F46E5' },
  { id: 'zhipu', label: '智谱 GLM-4.7 Flash', envVar: 'ZHIPU_API_KEY', baseURL: 'https://open.bigmodel.cn/api/paas/v4', color: '#3B82F6' },
];

export const Settings: React.FC = () => {
  const { provider, hasKey, setProvider, setHasKey } = useSettingsStore();
  const { active, setActive, abRatio, setAbRatio } = useFrameworkStore();
  const { defaultMode, setDefaultMode, recommendEnabled, setRecommendEnabled } = useModeStore();
  
  // 密钥状态
  const [allKeyStatus, setAllKeyStatus] = useState<Record<string, { ok: boolean; masked: string; envVar: string }>>({});
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  
  // 商用模型
  const { models, addModel, removeModel, commercialKeys, setCommercialKey, removeCommercialKey } = useModelStore();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [configuringTemplate, setConfiguringTemplate] = useState<string | null>(null);
  const [templateApiKey, setTemplateApiKey] = useState('');
  
  // 自定义模型
  const [newModel, setNewModel] = useState({ label: '', baseURL: '', apiKey: '', modelName: '', color: '#6366F1', modelType: 'chat' as 'chat' | 'image' | 'video' });
  const [testingCustom, setTestingCustom] = useState(false);
  
  // SuperAPI 模型工厂
  const [superApiKey, setSuperApiKey] = useState('');
  const [testingSuperApi, setTestingSuperApi] = useState(false);
  const [superApiExpanded, setSuperApiExpanded] = useState(false); // SuperAPI 子模型列表折叠状态
  
  // 通知设置
  const [desktopNotify, setDesktopNotify] = useState(taskNotifier.desktopEnabled);
  const [soundNotify, setSoundNotify] = useState(taskNotifier.soundEnabled);
  const [ttsEnabled, setTtsEnabledState] = useState(() => isTtsEnabled());
  const [autoResume, setAutoResume] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agentai.settings.autoResume') || 'true'); } catch { return true; }
  });

  // QQ Bot 状态
  const [qqStatus, setQQStatus] = useState<{ online: boolean; lastSeen: number; messageCount: number; sessionId: string }>({
    online: false, lastSeen: 0, messageCount: 0, sessionId: '',
  });
  // MCP 配置弹窗
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  // Feature flags (灰度开关)
  const [featureFlags, setFeatureFlags] = useState({
    useNewModelSelector: false,
    enableDiagnosisPipeline: true,
    newModelSelectorTrafficPercent: 0,
  });
  const [savingFlags, setSavingFlags] = useState(false);

  // 加载所有 provider 的 key 状态
  const loadAllKeyStatus = async () => {
    const allProviders = [
      ...FREE_MODELS.map(m => ({ id: m.id, envVar: m.envVar })),
      ...MODEL_TEMPLATES.map(t => ({ id: t.id, envVar: `${t.id.toUpperCase()}_API_KEY` })),
      { id: 'superapi', envVar: 'SUPERAPI_API_KEY' },
      { id: 'sensenova', envVar: 'SENSENOVA_API_KEY' },
      { id: 'longcat', envVar: 'LONGCAT_API_KEY' },
      // nvidia API key 检查已移除
    ];
    const results: Record<string, { ok: boolean; masked: string; envVar: string }> = {};
    for (const p of allProviders) {
      try {
        const r = await fetch(httpUrl() + `/v1/settings/keys?provider=${p.id}`);
        if (r.ok) {
          const data = await r.json();
          results[p.id] = data;
        } else {
          results[p.id] = { ok: false, masked: '未配置', envVar: p.envVar };
        }
      } catch {
        results[p.id] = { ok: false, masked: 'gateway 离线', envVar: p.envVar };
      }
    }
    setAllKeyStatus(results);
  };

  /** 测试模型连接 (通过 Gateway 代理, 验证与聊天相同的网络路径) */
  const testConnection = async (baseURL: string, apiKey: string, modelName: string, testId: string) => {
    setTestingId(testId);
    try {
      // 优先使用新端点 /v1/models/provider/:name/test-key (支持实时传递 apiKey)
      const providerName = testId.replace(/^cfg-/,'');
      const resp = await fetch(httpUrl() + `/v1/models/provider/${providerName}/test-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        message.success(`✅ ${providerName} 连接成功`);
        return true;
      } else {
        message.warning(`⚠️ 连接失败: ${data.error || `HTTP ${resp.status}`}`);
        return false;
      }
    } catch (e: any) {
      // Fallback: 旧接口
      try {
        const oldResp = await fetch(httpUrl() + '/v1/settings/keys/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: testId.replace(/^cfg-/,''),
            baseURL,
            modelName,
            apiKey,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const oldData = await oldResp.json();
        if (oldResp.ok && oldData.ok) {
          message.success(`✅ ${testId || baseURL} 连接成功`);
          return true;
        } else {
          message.warning(`⚠️ 连接失败: ${oldData.error || `HTTP ${oldResp.status}`}`);
          return false;
        }
      } catch (e2: any) {
        message.error(`❌ 连接失败: ${e.message}`);
        return false;
      }
    } finally {
      setTestingId(null);
    }
  };

  /** 保存 API Key 到 gateway */
  const saveApiKeyToGateway = async (providerId: string, apiKey: string) => {
    try {
      const r = await fetch(httpUrl() + '/v1/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      if (r.ok) {
        message.success(`✅ ${providerId} Key 已保存`);
        // 同时缓存到本地（用 sessionStorage 替代 localStorage，关闭浏览器自动销毁）
        const envVar = `${providerId.toUpperCase()}_API_KEY`;
        setCommercialKey(envVar, apiKey);
        saveApiKey(envVar, apiKey);
        loadAllKeyStatus();
        // 刷新动态模型列表
        useModelStore.getState().loadDynamicModels();
        return true;
      } else {
        const err = await r.json();
        message.error('保存失败: ' + (err.error || r.status));
        return false;
      }
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
      return false;
    }
  };

  /** 启用模板关联的所有模型 (主模型 + extraModelIds) */
  const toggleTemplateModels = (template: ModelTemplate, enabled: boolean) => {
    const store = useModelStore.getState();
    store.toggleModel(template.id, enabled);
    if (template.extraModelIds) {
      template.extraModelIds.forEach(extraId => {
        const extra = models.find(m => m.id === extraId);
        if (extra && extra.enabled !== enabled) {
          store.toggleModel(extraId, enabled);
        }
      });
    }
  };

  /** 配置商用模型模板 (测试+保存+启用) */
  const configureTemplate = async (template: ModelTemplate) => {
    if (!templateApiKey.trim()) {
      message.warning('请输入 API Key');
      return;
    }
    // 先保存密钥, 确保 process.env 中存在
    const saved = await saveApiKeyToGateway(template.id, templateApiKey);
    if (!saved) {
      message.error('密钥保存失败，无法继续');
      return;
    }
    // 再通过 Gateway 代理测试连接
    const ok = await testConnection(template.baseURL, templateApiKey, template.models[0], template.id);
    if (ok) {
      // 启用模板关联的所有模型
      toggleTemplateModels(template, true);
      message.success(`✅ 「${template.label}」已配置完成并启用`);
    } else {
      Modal.confirm({
        title: '连接测试未通过',
        content: `「${template.label}」通过 Gateway 代理测试连接失败，可能是密钥无效或网络问题。是否仍要启用？`,
        okText: '仍要启用',
        cancelText: '取消',
        onOk: () => {
          toggleTemplateModels(template, true);
          message.success(`✅ 「${template.label}」已启用（未验证连接）`);
        },
      });
    }
    setConfiguringTemplate(null);
    setTemplateApiKey('');
  };

  /** 单独测试并启用模型中单个 model (非模板配置流程) */
  const enableSingleModel = async (template: ModelTemplate) => {
    if (!templateApiKey.trim()) {
      message.warning('请输入 API Key');
      return;
    }
    const saved = await saveApiKeyToGateway(template.id, templateApiKey);
    if (!saved) {
      message.error('密钥保存失败');
      return;
    }
    const ok = await testConnection(template.baseURL, templateApiKey, template.models[0], template.id);
    if (ok) {
      toggleTemplateModels(template, true);
      message.success(`✅ 「${template.label}」已配置完成并启用，可在模型选择器中切换使用`);
    } else {
      Modal.confirm({
        title: '连接测试未通过',
        content: `「${template.label}」测试连接失败，是否仍要启用？`,
        okText: '仍要启用',
        cancelText: '取消',
        onOk: () => {
          toggleTemplateModels(template, true);
          message.success(`✅ 「${template.label}」已启用（未验证连接）`);
        },
      });
    }
    setTestingId(null);
    setConfiguringTemplate(null);
  };

  const saveTemplateConfig = async (template: ModelTemplate) => {
    const saved = await saveApiKeyToGateway(template.id, templateApiKey);
    if (saved) {
      // 启用该模型
      const model = models.find(m => m.id === template.id);
      if (model) {
        useModelStore.getState().toggleModel(template.id, true);
      }
      message.success(`✅ 「${template.label}」已配置完成并启用，可在模型选择器中切换使用`);
    }
    setConfiguringTemplate(null);
    setTemplateApiKey('');
  };

  /** 添加自定义模型到 store (测试通过后调用) */
  const doAddCustomModel = async () => {
    const providerId = `custom_${newModel.label.toLowerCase().replace(/\s+/g, '_')}`;
    addModel({
      label: newModel.label,
      baseURL: newModel.baseURL,
      apiKeyEnv: `${providerId.toUpperCase()}_API_KEY`,
      color: newModel.color,
      enabled: true,
      provider: providerId,
      models: newModel.modelName ? [newModel.modelName] : undefined,
    });
    // 保存 API Key 到 gateway 和本地缓存（sessionStorage 替代 localStorage）
    const envVar = `${providerId.toUpperCase()}_API_KEY`;
    setCommercialKey(envVar, newModel.apiKey);
    saveApiKey(envVar, newModel.apiKey);
    try {
      const r = await fetch(httpUrl() + '/v1/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: newModel.apiKey }),
      });
      if (r.ok) {
        message.success(`✅ 已添加模型「${newModel.label}」并保存密钥到 gateway`);
      } else {
        const err = await r.json().catch(() => ({}));
        message.warning(`⚠️ 模型已添加到本地, 但密钥同步到 gateway 失败: ${err.error || r.status}`);
      }
    } catch (e: any) {
      message.warning(`⚠️ 模型已添加到本地, 但密钥同步到 gateway 失败: ${e.message}`);
    }
    setNewModel({ label: '', baseURL: '', apiKey: '', modelName: '', color: '#6366F1', modelType: 'chat' as 'chat' | 'image' | 'video' });
    // 重新加载密钥状态
    loadAllKeyStatus();
  };

  useEffect(() => {
    loadAllKeyStatus();
    const t = setInterval(loadAllKeyStatus, 10000);

    const loadQQStatus = async () => {
      try {
        const r = await fetch(httpUrl() + '/v1/qq/status');
        if (r.ok) setQQStatus(await r.json());
      } catch { /* gateway offline */ }
    };
    loadQQStatus();
    const q = setInterval(loadQQStatus, 5000);

    // 加载灰度开关
    (async () => {
      try {
        const r = await fetch(httpUrl() + '/v1/feature-flags');
        if (r.ok) {
          const data = await r.json();
          setFeatureFlags(prev => ({
            ...prev,
            ...data,
            useNewModelSelector: data.useNewModelSelector ?? prev.useNewModelSelector,
            enableDiagnosisPipeline: data.enableDiagnosisPipeline ?? prev.enableDiagnosisPipeline,
            newModelSelectorTrafficPercent: data.newModelSelectorTrafficPercent ?? prev.newModelSelectorTrafficPercent,
          }));
        }
      } catch { /* ignore */ }
    })();

    return () => { clearInterval(t); clearInterval(q); };
  }, []);

return (
<div style={{ padding: '12px 16px', color: 'var(--fg)', maxWidth: 900, margin: '0 auto' }}>
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
<SettingOutlined style={{ fontSize: 16, color: 'var(--accent)' }} />
<span style={{ fontSize: 15, fontWeight: 600 }}>岐枢设置</span>
</div>

      <Tabs
        defaultActiveKey="models"
        items={[
          // ========== 通用设置 ==========
          {
            key: 'general',
            label: <span><AppstoreOutlined /> 通用设置</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Divider style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>通知提醒</Divider>
                  {/* ... desktop notify ... */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}><BellOutlined /> 桌面通知</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>任务完成时弹出桌面通知 (需浏览器权限)</Text>
                    </div>
                    <Switch checked={desktopNotify} onChange={(v) => { setDesktopNotify(v); taskNotifier.setDesktopEnabled(v); }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}><SoundOutlined /> 提示音</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>任务完成时播放提示音</Text>
                    </div>
                    <Switch checked={soundNotify} onChange={(v) => { setSoundNotify(v); taskNotifier.setSoundEnabled(v); }} />
                  </div>

                  <Divider style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>语音</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}><SoundOutlined /> AI 回复语音播报</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>AI 回复完成时自动朗读</Text>
                    </div>
                    <Switch checked={ttsEnabled} onChange={(v) => { setTtsEnabledState(v); setTtsEnabled(v); }} />
                  </div>
                  
                  {/* 音色选择 */}
                  {ttsEnabled && (
                    <div style={{ marginTop: 12, marginLeft: 24 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 8 }}>选择音色</div>
                      <VoiceSelector />
                    </div>
                  )}

                  <Divider style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>自动化</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>🤖 自动恢复</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>AI 意外中止时自动发送 continue 恢复任务</Text>
                    </div>
                    <Switch checked={autoResume} onChange={(v) => { setAutoResume(v); localStorage.setItem('agentai.settings.autoResume', JSON.stringify(v)); }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>💬 追问卡片</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>AI 遇到不明确需求时触发审批卡片让用户确认</Text>
                    </div>
                    <Switch defaultChecked onChange={(v) => localStorage.setItem('agentai.settings.askUser', JSON.stringify(v))} />
                  </div>

                  <Divider style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>模式设置</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>🔮 默认模式</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>新会话启动时的默认运行模式</Text>
                    </div>
                    <Select
                      size="small"
                      value={defaultMode}
                      onChange={(v: AppMode) => setDefaultMode(v)}
                      style={{ width: 120 }}
                      options={MODE_ORDER.map(m => ({ value: m, label: `${MODE_CONFIG[m].icon} ${MODE_CONFIG[m].label}` }))}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>💡 智能模式推荐</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>根据消息内容自动推荐更合适的模式</Text>
                    </div>
                    <Switch checked={recommendEnabled} onChange={(v) => setRecommendEnabled(v)} />
                  </div>

                  <Divider style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>存储</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>💾 自动记忆</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>对话完成时自动保存到 MemoryEngine</Text>
                    </div>
                    <Switch defaultChecked onChange={(v) => localStorage.setItem('agentai.settings.autoMemory', JSON.stringify(v))} />
                  </div>
                  <Alert type="info" message="以上设置立即生效, 无需重启" style={{ fontSize: 11 }} />
                </Space>
              </Card>
            ),
          },

          // ========== 模型配置 (免费 + 商用) ==========
          {
            key: 'models',
            label: <span><ApiOutlined /> 模型配置</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={20}>
                  
                  {/* ===== 免费模型区域 ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 14, color: 'var(--success)', margin: 0 }}>
                      <ThunderboltOutlined style={{ color: 'var(--success)', marginRight: 6 }} />
                      免费模型 (内置, 无需配置)
                    </Divider>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                      {FREE_MODELS.map(m => {
                        const status = allKeyStatus[m.id];
                        return (
                          <div key={m.id} style={{
                            padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 8,
                            background: 'var(--panel)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <Space>
                              <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                              <Text strong style={{ color: 'var(--fg)' }}>{m.label}</Text>
                              <Tag color="green">免费</Tag>
                              <code style={{ fontSize: 10, color: 'var(--muted)' }}>{m.baseURL}</code>
                            </Space>
                            <Space>
                              {status?.ok
                                ? <Tag color="success">✓ 可用 ({status.masked})</Tag>
                                : <Tag color="warning">⚠ 未配置 Key</Tag>
                              }
                              {editingProvider === m.id ? (
                                <Space.Compact>
                                  <Input.Password
                                    size="small"
                                    value={editApiKey}
                                    onChange={e => setEditApiKey(e.target.value)}
                                    placeholder="输入 API Key..."
                                    style={{ width: 200 }}
                                  />
                                  <Button size="small" type="primary" icon={<SaveOutlined />} onClick={async () => {
                                    if (await saveApiKeyToGateway(m.id, editApiKey)) setEditingProvider(null);
                                  }}>保存</Button>
                                  <Button size="small" onClick={() => setEditingProvider(null)}>取消</Button>
                                </Space.Compact>
                              ) : (
                                <Button size="small" type="link" onClick={() => { setEditingProvider(m.id); setEditApiKey(''); }}>
                                  配置 Key
                                </Button>
                              )}
                            </Space>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, paddingLeft: 4 }}>
                      <ThunderboltOutlined /> 免费模型可用于主对话和子任务，自动切换，无速率限制担忧
                    </div>
                  </div>

                  {/* ===== SuperAPI 模型工厂 (迁至商业模型上方) ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 14, color: 'var(--violet)', margin: 0 }}>
                      <ApiOutlined style={{ color: 'var(--violet)', marginRight: 6 }} />
                      SuperAPI 模型工厂 (一个密钥接入全部模型)
                    </Divider>

                    <Alert
                      type="info"
                      style={{ marginTop: 8, marginBottom: 12, fontSize: 12 }}
                      message={
                        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                          <div><strong>SuperAPI</strong> 是一个聚合 API，使用单一个密钥即可接入 DeepSeek、千问、GLM、Kimi 等多个模型。</div>
                          <div style={{ marginTop: 4 }}>
                            🔑 获取密钥及充值请联系开发者 — 提供密钥后在此处配置即可使用。
                          </div>
                          <div style={{ marginTop: 2, color: 'var(--violet)' }}>
                            <LinkOutlined /> API 端点: <code>https://superapi.vanguard.dpdns.org/v1</code> (OpenAI 兼容协议)
                          </div>
                        </div>
                      }
                    />

                    {/* SuperAPI API Key 配置 */}
                    <div style={{ marginBottom: 12 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input.Password
                          value={superApiKey}
                          onChange={e => setSuperApiKey(e.target.value)}
                          placeholder="输入 SuperAPI 密钥..."
                          style={{ flex: 1 }}
                        />
                        <Button
                          type="primary"
                          icon={testingSuperApi ? <LoadingOutlined /> : <CheckOutlined />}
                          onClick={async () => {
                            if (!superApiKey.trim()) { message.warning('请输入 SuperAPI 密钥'); return; }
                            setTestingSuperApi(true);
                            const ok = await testConnection(
                              'https://superapi.vanguard.dpdns.org/v1',
                              superApiKey,
                              'deepseek-v4-flash',
                              'superapi-test'
                            );
                            setTestingSuperApi(false);
                            if (ok) {
                              await saveApiKeyToGateway('superapi', superApiKey);
                              message.success('SuperAPI 密钥已保存');
                            } else {
                              message.error('连接测试失败，请检查密钥是否正确');
                            }
                          }}
                          loading={testingSuperApi}
                        >
                          测试并保存密钥
                        </Button>
                      </Space.Compact>
                    </div>

                    {/* SuperAPI 子模型列表 (折叠展开, 默认折叠避免页面过长) */}
                    <div
                      style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => setSuperApiExpanded(!superApiExpanded)}
                    >
                      {superApiExpanded ? '▼' : '▶'} 子模型列表 ({SUPERAPI_MODEL_LIST.length} 个, 启用后出现在模型选择器中)
                    </div>
                    {superApiExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {SUPERAPI_MODEL_LIST.map(m => {
                        const modelInStore = models.find(x => x.id === `superapi-${m.id}`);
                        const isEnabled = modelInStore?.enabled ?? false;
                        const hasKey = !!localStorage.getItem('SUPERAPI_API_KEY') || (superApiKey?.length > 0);
                        return (
                          <div key={m.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', borderRadius: 8,
                            background: 'var(--bg-2)', border: isEnabled ? '1px solid #8B5CF6' : '1px solid var(--border)',
                          }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>
                                SuperAPI · {m.label}
                                {isEnabled && <Tag style={{ marginLeft: 6, fontSize: 9, lineHeight: '14px', padding: '0 4px' }} color="purple">已启用</Tag>}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>
                                输入 ¥{m.priceIn}/1M · 输出 ¥{m.priceOut}/1M{m.priceCache ? ` · 缓存 ¥${m.priceCache}/1M` : ''}
                                {m.level && <span> · <Tag style={{ fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>{m.level}</Tag></span>}
                              </div>
                            </div>
                            <Button
                              size="small"
                              type={isEnabled ? 'primary' : 'default'}
                              icon={isEnabled ? <CheckOutlined /> : <ApiOutlined />}
                              disabled={!hasKey}
                              onClick={() => useModelStore.getState().toggleModel(`superapi-${m.id}`, !isEnabled)}
                              style={{ fontSize: 10 }}
                            >
                              {isEnabled ? '已启用' : '启用'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>

                  {/* ===== 商用模型区域 (备选接入方案) ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 14, color: 'var(--warning)', margin: 0 }}>
                      <CrownOutlined style={{ color: 'var(--warning)', marginRight: 6 }} />
                      商用模型 (需配置 API Key)
                    </Divider>
                    
                    {/* 预配置模板列表 */}
                    <Collapse
                      ghost
                      size="small"
                      items={MODEL_TEMPLATES.map(t => {
                        const status = allKeyStatus[t.id];
                        // 模板 "已启用" 包括主模型 + extraModelIds 任意一个开启
                        const relatedIds = [t.id, ...(t.extraModelIds || [])];
                        const isEnabled = models.some(m => relatedIds.includes(m.id) && m.enabled);
                        return {
                          key: t.id,
                          label: (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                              <Space>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, display: 'inline-block' }} />
                                <Text strong style={{ color: 'var(--fg)' }}>{t.label}</Text>
                                {['sensenova', 'longcat'].includes(t.id)
                                  ? <Tag color="green">免费额度</Tag>
                                  : <Tag color="orange">付费</Tag>
                                }
                                <code style={{ fontSize: 10, color: 'var(--muted)' }}>{t.baseURL}</code>
                              </Space>
                              <Space>
                                {status?.ok
                                  ? <Tag color="success">✓ 已配置</Tag>
                                  : <Tag>未配置</Tag>
                                }
                                {isEnabled && <Tag color="blue">已启用</Tag>}
                              </Space>
                            </div>
                          ),
                          children: (
                            <div style={{ padding: '8px 0' }}>
                              <div style={{ marginBottom: 8 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>可用模型: </Text>
                                {t.models.map((m, i) => (
                                  <Tag key={m} style={{ fontSize: 10, marginRight: 4 }}>
                                    {m}
                                  </Tag>
                                ))}
                              </div>
                              <div style={{ marginBottom: 8 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  <LinkOutlined /> 获取密钥: <a href={t.docsUrl} target="_blank" rel="noreferrer">{t.docsUrl}</a>
                                </Text>
                              </div>
                              
                              {configuringTemplate === t.id ? (
                                <Space.Compact style={{ width: '100%' }}>
                                  <Input.Password
                                    value={templateApiKey}
                                    onChange={e => setTemplateApiKey(e.target.value)}
                                    placeholder="输入 API Key..."
                                    style={{ flex: 1 }}
                                  />
                                  <Button
                                    type="primary"
                                    icon={testingId === `cfg-${t.id}` ? <LoadingOutlined /> : <CheckOutlined />}
                                    onClick={() => configureTemplate(t)}
                                    loading={testingId === `cfg-${t.id}`}
                                  >
                                    测试并保存
                                  </Button>
                                  <Button onClick={() => { setConfiguringTemplate(null); setTemplateApiKey(''); }}>取消</Button>
                                </Space.Compact>
                              ) : (
                                <Space>
                                  <Button
                                    size="small"
                                    icon={<KeyOutlined />}
                                    onClick={() => { setConfiguringTemplate(t.id); setTemplateApiKey(''); }}
                                  >
                                    配置 API Key
                                  </Button>
                                  <Button
                                    size="small"
                                    icon={<CheckCircleOutlined />}
                                    onClick={() => testConnection(t.baseURL, getApiKey(`${t.id.toUpperCase()}_API_KEY`) || commercialKeys[`${t.id.toUpperCase()}_API_KEY`] || '', t.models[0], t.id)}
                                    loading={testingId === t.id}
                                  >
                                    测试连接
                                  </Button>
                                  {status?.ok && (
                                    <Button
                                      size="small"
                                      type={isEnabled ? 'primary' : 'default'}
                                      icon={<ApiOutlined />}
                                      onClick={() => useModelStore.getState().toggleModel(t.id, !isEnabled)}
                                    >
                                      {isEnabled ? '已启用' : '启用'}
                                    </Button>
                                  )}
                                </Space>
                              )}
                            </div>
                          ),
                        };
                      })}
                    />
                  </div>

                  {/* ===== 自定义模型区域 ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 14, color: 'var(--muted)', margin: 0 }}>
                      <PlusOutlined style={{ marginRight: 6 }} />
                      自定义模型 (任意 OpenAI 兼容 API)
                    </Divider>
                    
                    {/* 已添加的自定义模型列表 */}
                    {models.filter(m => !m.isBuiltIn).length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>已添加的模型:</div>
                        {/* 按类型分组显示 */}
                        {(['image', 'video', 'chat'] as const).map(type => {
                          const typeModels = models.filter(m => !m.isBuiltIn && m.modelType === type);
                          if (typeModels.length === 0) return null;
                          const typeLabel = type === 'image' ? '🎨 图像模型' : type === 'video' ? '🎬 视频模型' : '💬 文本模型';
                          const typeColor = type === 'image' ? '#EC4899' : type === 'video' ? '#8B5CF6' : '#3B82F6';
                          return (
                            <div key={type} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: typeColor, marginBottom: 6 }}>{typeLabel}</div>
                              {typeModels.map((m, idx) => (
                                <div key={m.id} style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '8px 12px', borderRadius: 8,
                                  background: 'var(--bg-2)', border: '1px solid var(--border)', marginBottom: 6,
                                }}>
                                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{m.label}</div>
                                    <div style={{ fontSize: 10, color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.baseURL}</div>
                                  </div>
                                  <Button
                                    size="small"
                                    icon={<CheckCircleOutlined />}
                                    onClick={() => testConnection(m.baseURL, getApiKey(m.apiKeyEnv) || commercialKeys[m.apiKeyEnv] || '', m.models?.[0] || m.label, `custom-${idx}`)}
                                    loading={testingId === `custom-${idx}`}
                                    style={{ fontSize: 10 }}
                                  >测试</Button>
                                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => {
                                    // 清理: 移除模型 + 删除 API Key (commercialKeys + sessionStorage + gateway)
                                    const envVar = m.apiKeyEnv;
                                    if (envVar) {
                                      removeApiKey(envVar);
                                      removeCommercialKey(envVar);
                                      // 同步删除 gateway .env 中的密钥
                                      fetch(httpUrl() + '/v1/settings/keys', {
                                        method: 'DELETE',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ provider: m.provider || m.id }),
                                      }).catch(() => {});
                                    }
                                    removeModel(m.id);
                                    message.info(`已移除「${m.label}」及其密钥`);
                                  }} style={{ fontSize: 10 }} />
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <Form layout="vertical" size="small" style={{ marginTop: 12 }}>
                      <Form.Item label="模型名称 (显示名)">
                        <Input value={newModel.label} onChange={e => setNewModel(p => ({ ...p, label: e.target.value }))} placeholder="例: 自定义 GPT-4o" />
                      </Form.Item>
                      <Form.Item label="Base URL (API 端点)">
                        <Input value={newModel.baseURL} onChange={e => setNewModel(p => ({ ...p, baseURL: e.target.value }))} placeholder="例: https://api.openai.com/v1" />
                      </Form.Item>
                      <Form.Item label="模型名 (Model Name)">
                        <Input value={newModel.modelName} onChange={e => setNewModel(p => ({ ...p, modelName: e.target.value }))} placeholder="例: gpt-4o (留空则使用模型名称)" />
                      </Form.Item>
                      <Form.Item label="API Key">
                        <Input.Password value={newModel.apiKey} onChange={e => setNewModel(p => ({ ...p, apiKey: e.target.value }))} placeholder="sk-..." />
                      </Form.Item>
                      <Form.Item label="模型类型">
                        <Select
                          value={newModel.modelType || 'chat'}
                          onChange={v => setNewModel(p => ({ ...p, modelType: v }))}
                          options={[
                            { label: '文本模型 (对话/写作)', value: 'chat' },
                            { label: '图像模型 (生图/改图)', value: 'image' },
                            { label: '视频模型 (生视频)', value: 'video' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" icon={<PlusOutlined />} onClick={async () => {
                          if (!newModel.label || !newModel.baseURL || !newModel.apiKey) {
                            message.warning('请填写模型名称、Base URL 和 API Key');
                            return;
                          }
                          setTestingCustom(true);
                          const ok = await testConnection(newModel.baseURL, newModel.apiKey, newModel.modelName || newModel.label, 'custom-new');
                          setTestingCustom(false);
                          if (!ok) {
                            Modal.confirm({
                              title: '连接测试未通过',
                              content: '测试连接失败，仍然添加此模型吗？',
                              okText: '仍要添加',
                              cancelText: '取消',
                              onOk: () => doAddCustomModel(),
                            });
                            return;
                          }
                          doAddCustomModel();
                        }} loading={testingCustom}>
                          测试连接并添加
                        </Button>
                      </Form.Item>
                    </Form>
                  </div>

                </Space>
              </Card>
            ),
          },

          // ========== 强模型推荐 ==========
          {
            key: 'pro-recommend',
            label: <span><SecurityScanOutlined /> 强模型推荐</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert
                    type="info"
                    message="智能模型切换"
                    description="系统会根据任务复杂度自动推荐合适的模型：简单对话用免费模型，代码审查/架构设计/安全分析等复杂任务建议用强模型以获得更好的结果。"
                  />
                  <div style={{ padding: '16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <ThunderboltOutlined style={{ color: 'var(--warning)' }} />
                        <Text strong>DeepSeek V4 Pro</Text>
                        <Tag color="orange">付费</Tag>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>强力推理, 适合代码审查/架构/安全</span>
                      </Space>
                      <Space>
                        {allKeyStatus.deepseek?.ok
                          ? <Tag color="success">✓ Key 已配置</Tag>
                          : <Button size="small" type="primary" onClick={async () => {
                              const key = prompt('请输入 DeepSeek API Key (从 platform.deepseek.com 获取):');
                              if (!key?.trim()) return;
                              await saveApiKeyToGateway('deepseek', key.trim());
                            }}>一键启用</Button>
                        }
                      </Space>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    💡 提示: 配置 DeepSeek Key 后, 当你执行代码审查、架构设计、安全分析等任务时, AI 会自动建议切换到 V4 Pro。你也可以随时在模型选择器中手动切换。
                  </div>
                </Space>
              </Card>
            ),
          },

          // ========== 框架切换 ==========
          {
            key: 'framework',
            label: <span><ThunderboltOutlined /> 框架切换</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <div>
                    <div style={{ color: 'var(--muted)', marginBottom: 8 }}>当前框架</div>
                    <Space>
                      <Button type={active === 'agentai' ? 'primary' : 'default'} onClick={() => setActive('agentai')}>岐枢 PulseFlow (自研框架)</Button>
                      <Button type={active === 'hermes' ? 'primary' : 'default'} onClick={() => setActive('hermes')} style={active === 'hermes' ? { background: '#9333EA', borderColor: '#9333EA' } : undefined}>Hermes (多渠道网关)</Button>
                    </Space>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted)' }}>A/B 灰度: {(abRatio * 100).toFixed(0)}% → {active}</div>
                    <input type="range" min={0} max={1} step={0.05} value={abRatio} onChange={(e) => setAbRatio(parseFloat(e.target.value))} style={{ width: '100%' }} />
                  </div>
                  <Alert type="info" message="关于框架" description={<ul style={{ marginBottom: 0, paddingLeft: 18 }}><li>岐枢 PulseFlow: 自研系统提示 + 工具描述, 适合代码/工具调用</li><li>Hermes: 自研多渠道网关, 适合多平台对话</li><li>A/B 灰度: 1.0 = 全走岐枢, 0.0 = 全走 Hermes</li><li>切换后新建对话即生效, 无需重启</li></ul>} />
                  <Divider />
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>⚙️ 灰度功能开关</div>
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>新模型选择器 <Tag style={{ fontSize: 9 }}>useNewModelSelector</Tag></span>
                        <Switch checked={featureFlags.useNewModelSelector} onChange={(v) => setFeatureFlags(f => ({ ...f, useNewModelSelector: v }))} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>诊断优先主链路 <Tag style={{ fontSize: 9 }}>enableDiagnosisPipeline</Tag></span>
                        <Switch checked={featureFlags.enableDiagnosisPipeline} onChange={(v) => setFeatureFlags(f => ({ ...f, enableDiagnosisPipeline: v }))} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>新选择器流量: {featureFlags.newModelSelectorTrafficPercent}%</span>
                        <input type="range" min={0} max={100} step={5}
                          value={featureFlags.newModelSelectorTrafficPercent}
                          onChange={(e) => setFeatureFlags(f => ({ ...f, newModelSelectorTrafficPercent: parseInt(e.target.value) }))}
                          style={{ width: 120 }} />
                      </div>
                      <Button size="small" loading={savingFlags}
                        onClick={async () => {
                          setSavingFlags(true);
                          try {
                            await fetch(`${httpUrl()}/v1/feature-flags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(featureFlags) });
                            message.success('灰度开关已保存 (重启 Gateway 后基于 .env 的配置会覆盖)');
                          } catch { message.warning('保存失败, 仅本地生效'); }
                          setSavingFlags(false);
                        }}>
                        保存灰度设置
                      </Button>
                    </Space>
                  </div>
                </Space>
              </Card>
            ),
          },

          // ========== QQ Bot ==========
          {
            key: 'qq',
            label: <span><RobotOutlined /> QQ Bot</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Space>
                    {qqStatus.online ? <Tag color="success">已连接</Tag> : <Tag color="default">未连接</Tag>}
                    {qqStatus.sessionId && <span style={{ color: 'var(--muted)', fontSize: 12 }}>Session: {qqStatus.sessionId}</span>}
                  </Space>
                  {qqStatus.online && (
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="消息数">{qqStatus.messageCount}</Descriptions.Item>
                      <Descriptions.Item label="上次心跳">{new Date(qqStatus.lastSeen).toLocaleTimeString()}</Descriptions.Item>
                    </Descriptions>
                  )}
                  <Alert type="info" message="QQ 机器人说明" description={<ul style={{ marginBottom: 0, paddingLeft: 18 }}><li>QQ Bot 作为独立进程运行, 通过 HTTP 调 Gateway</li><li>启动: <code>AGENTAI_QQ_APPID=xxx AGENTAI_QQ_SECRET=xxx pnpm --filter agentai-qqbot dev</code></li><li>使用 QQ 官方机器人 API (非 go-cqhttp)</li><li>支持私聊/群聊, 远程命令 (/help /new /abort /model 等)</li><li>获取 AppID/Secret: <a href="https://q.qq.com/" target="_blank">QQ 开放平台</a></li></ul>} />
                </Space>
              </Card>
            ),
          },

          // ========== 沙箱规则 ==========
          {
            key: 'sandbox',
            label: <span><SecurityScanOutlined /> 沙箱规则</span>,
            children: <SandboxRulesEditor />,
          },
          // ========== AI 进化 ==========
          {
            key: 'evolution',
            label: <span><ExperimentOutlined /> AI 进化</span>,
            children: (
              <Card>
                <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--muted-2)' }}>
                  AI 会跨会话学习你的偏好和教训, 越用越懂你。这里可以查看和管理 AI 学到的内容。
                </div>
                <EvolutionPanel />
              </Card>
            ),
          },

          // ========== MCP 配置 ==========
          {
            key: 'mcp',
            label: <span><ApiOutlined /> MCP 配置</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert type="info" message="MCP (Model Context Protocol) 服务器"
                    description="MCP 让 AI 通过标准协议访问外部工具和数据源。默认 memory 已启用, 其他需配置环境变量。" />
                  <Button icon={<ApiOutlined />} onClick={() => setMcpModalOpen(true)}>
                    打开 MCP 配置面板
                  </Button>
                </Space>
                <MCPConfigModal open={mcpModalOpen} onClose={() => setMcpModalOpen(false)} />
              </Card>
            ),
          },

          // ========== 自动更新 ==========
          {
            key: 'updater',
            label: <span><SyncOutlined /> 自动更新</span>,
            children: <UpdaterPanel />,
          },

          // ========== 关于 ==========
          {
            key: 'about',
            label: <span>关于</span>,
            children: (
              <Card>
                <Descriptions column={1} bordered>
                  <Descriptions.Item label="项目">岐枢 PulseFlow v0.4.0-alpha</Descriptions.Item>
                  <Descriptions.Item label="桌面壳">Tauri 2.0 (5-10MB)</Descriptions.Item>
                  <Descriptions.Item label="Gateway">Node.js + Socket.io (18789)</Descriptions.Item>
                  <Descriptions.Item label="VSCode 扩展">.vsix 18.9 KB</Descriptions.Item>
                  <Descriptions.Item label="QQ 机器人">独立 agentai-qqbot 包</Descriptions.Item>
                  <Descriptions.Item label="多模态">Agnes Image 2.1 + Video v2.0</Descriptions.Item>
                  <Descriptions.Item label="3 框架参照">自研岐枢 PulseFlow + Hermes 多渠道</Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};
