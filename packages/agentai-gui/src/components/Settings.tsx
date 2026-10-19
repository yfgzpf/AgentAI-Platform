/**
 * 真设置页 - 密钥管理 / 免费模型 / 商用模型 / 启动 wizard 入口
 */
import React, { useState, useEffect } from 'react';
import { Card, Input, Button, Space, Tag, Alert, Form, message, Tabs, Descriptions, Select, Divider, Modal, Switch, Typography, Collapse, Tooltip, Table, App, Progress } from 'antd';
import { saveApiKey, getApiKey, removeApiKey } from '../services/secureKeyStorage';
import { KeyOutlined, SaveOutlined, ApiOutlined, SettingOutlined, ThunderboltOutlined, RobotOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, DeleteOutlined, BellOutlined, SoundOutlined, AppstoreOutlined, SecurityScanOutlined, CheckOutlined, LinkOutlined, CrownOutlined, ExperimentOutlined, PartitionOutlined, SyncOutlined, InfoCircleOutlined, DownloadOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { ModelSelector } from './ModelSelector';
import { SandboxRulesEditor } from './SandboxRulesEditor';
import { EvolutionPanel } from './EvolutionPanel';
import MCPConfigModal from './mcp/MCPConfigModal';
import { useSettingsStore, useFrameworkStore } from '../store';
import { useModelStore, type ModelConfig, FACTORY_KEY_GROUPS } from '../store/modelStore';
import { useModeStore, MODE_CONFIG, MODE_ORDER, type AppMode } from '../store/modeStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
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
            <Text code style={{ fontSize: 'var(--fs-micro)', userSelect: 'all' }}>
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
                {latest.body && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)', opacity: 0.88 }}>{latest.body}</div>}
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
          <Progress percent={progress} status="active" strokeColor={{ from: 'var(--success)', to: '#3B82F6' }} style={{ marginBottom: 8 }} />
        )}

        {error && (
          <Alert type="error" showIcon message="更新失败" description={<span style={{ fontSize: 'var(--fs-sm)' }}>{error}</span>} closable />
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
                <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 'var(--fs-md)' }}>
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
  /** provider 名 (同时用于密钥 env: `${id.toUpperCase()}_API_KEY`) */
  id: string;
  label: string;
  baseURL: string;
  models: string[];
  docsUrl: string;
  color: string;
  contextWindow: number;
  /** 在 modelStore 中与该模板共用同一密钥的其他 model id (例: deepseek → deepseek-flash) */
  extraModelIds?: string[];
}

const MODEL_TEMPLATES: ModelTemplate[] = [
  // id 是 provider 名 ('deepseek' → DEEPSEEK_API_KEY), 而 store 里的模型 id 是 'deepseek-flash',
  // 两者不再同名, 因此必须靠 extraModelIds 才能把模型置为 enabled —— 只写 id 会静默失效。
  // 2026-10-11: deepseek-v4-pro 已下线 (官方 2026-09-14 12:00 起全部路由到 V4.1 Flash), 从列表移除。
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-flash'], docsUrl: 'https://platform.deepseek.com/api-keys', color: 'var(--success)', contextWindow: 1000000, extraModelIds: ['deepseek-flash'] },
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

// ===== ALRC 聚合平台 - 模型列表及定价 =====
interface ALRCModel {
  id: string;
  label: string;
  color: string;
  priceIn: string;
  priceOut: string;
  /** 缓存读取价格 (可选, 与官方价目表口径一致时才展示) */
  priceCacheRead?: string;
  /** 缓存创建价格 (可选) */
  priceCacheCreate?: string;
  level?: string;
}
// ===== 模型工厂模型列表 (按量计费) =====
// 与 ALRO 平台 (https://alro.huazhiweilai.com) 实际可用模型保持同步
const FACTORY_MODEL_LIST: ALRCModel[] = [
  // DeepSeek
  // 2026-10-19: 官方已把 `deepseek-v4-flash` 下架, 统一为 `deepseek-flash` ——
  //   模型设置同步改名 (id 必须与 modelStore 的 models[] 一致, 否则"启用"按钮反查不到)。
  //   价格按 DeepSeek 官方价目表 (人民币 / 1M tokens), 含缓存读/缓存创建两档。
  { id: 'deepseek-flash', label: 'DeepSeek Flash ⭐', color: 'var(--success)', priceIn: '¥1.1110', priceOut: '¥4.4460', priceCacheRead: '¥0.0440', priceCacheCreate: '¥4.4460', level: '高性价比' },
  // 2026-10-11: deepseek-v4-pro 已下线, 从计费列表移除
  // 智谱 GLM
  { id: 'glm-4.7', label: 'GLM 4.7', color: '#3B82F6', priceIn: '$0.103', priceOut: '$0.31', level: '智谱' },
  { id: 'glm-5', label: 'GLM 5', color: '#2563EB', priceIn: '$0.207', priceOut: '$0.62', level: '智谱' },
  { id: 'glm-5.1', label: 'GLM 5.1', color: '#1D4ED8', priceIn: '$0.207', priceOut: '$0.62', level: '智谱' },
  { id: 'glm-5.2', label: 'GLM 5.2', color: '#1E40AF', priceIn: '$0.207', priceOut: '$0.62', level: '智谱最新' },
  // Kimi
  { id: 'kimi-k2.5', label: 'Kimi K2.5', color: '#6366F1', priceIn: '$0.138', priceOut: '$0.41', level: '月之暗面' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6', color: '#4F46E5', priceIn: '$0.207', priceOut: '$0.62', level: '月之暗面' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', color: '#4338CA', priceIn: '$0.207', priceOut: '$0.62', level: '代码专用' },
  { id: 'kimi-k3', label: 'Kimi K3', color: '#3730A3', priceIn: '$0.345', priceOut: '$1.04', level: '最新旗舰' },
  // MiniMax
  // 2026-10-13 修正: 与 modelStore 的 models[] 对齐(store 用 MiniMax-M2.5 / MiniMax-M2.7 / MiniMax/MiniMax-M3)
  { id: 'MiniMax-M2.5', label: 'MiniMax M2.5', color: '#8B5CF6', priceIn: '$0.103', priceOut: '$0.31', level: 'MiniMax' },
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', color: '#7C3AED', priceIn: '$0.207', priceOut: '$0.62', level: 'MiniMax' },
  { id: 'MiniMax/MiniMax-M3', label: 'MiniMax M3', color: '#6D28D9', priceIn: '$0.345', priceOut: '$1.04', level: 'MiniMax最新' },
  // 其他
  { id: 'hy3', label: 'HY3', color: 'var(--success)', priceIn: '$0.103', priceOut: '$0.31', level: '其他' },
];
// 模型工厂生图模型 (按次计费)
const FACTORY_IMAGE_MODEL_LIST: { id: string; label: string; color: string; price: string; desc: string }[] = [
  { id: 'nano-banana', label: 'Nano Banana', color: '#FBBF24', price: '$0.048/次', desc: 'Google · 标准版' },
  { id: 'nano-banana-2', label: 'Nano Banana 2 ⭐', color: '#F59E0B', price: '$0.041/次', desc: 'Google · 最新版 · 最便宜' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro', color: '#D97706', price: '$0.062/次', desc: 'Google · 旗舰版' },
  { id: 'gpt-image-2', label: 'GPT Image 2 ⭐', color: '#3B82F6', price: '$0.014/次', desc: 'OpenAI · 标准版 · 超值' },
  { id: 'gpt-image-2-vip', label: 'GPT Image 2 VIP', color: '#1D4ED8', price: '$0.045/次', desc: 'OpenAI · 高清版' },
];
// ✅ 批次9.1 (2026-10-13): 模型工厂生视频模型 (Alrc 中转 Seedance 2 系列, 按秒计费)。
// 与 modelStore.ts FACTORY_VIDEO_MODELS / factory-registry.ts 的 4 条严格 1:1
// (id 都是上游真实模型名 doubao-seedance-*), 走 FACTORY_VIDEO_KEY。
// 之前视频分组 groupModels 是 [] (显示占位"服务端尚未分配模型"), 导致 Settings 里
// "对应支持模型名"这一环断了 —— 用户填了视频密钥也不知道到底解锁了哪些模型。
// ⚠️ 价格数字来自 Alrc 截图口径 (按秒计费, 各分辨率不同), 官方价目表未核 —— 只用于 UI 展示。
// 🔒 2026-10-20: 本清单的 id 是**上游真实模型名** (测试探针 testModel 直接拿它打 ALRO,
//   见下方 group.id === 'video' ? 'doubao-seedance-2.5')。**不要**为了和下拉/engines 目录
//   "对齐"把它改成 factory-seedance-* —— 那是 modelStore 条目 id, 不是上游名, 改了探测必失败。
//   三处命名分工: 本清单=上游真实名 / modelStore id=下拉值 / VIDEO_ENGINES name=灰显查询键。
const FACTORY_VIDEO_MODEL_LIST: { id: string; label: string; color: string; price: string; desc: string }[] = [
  { id: 'doubao-seedance-2.5', label: 'Seedance 2.5', color: '#7C3AED', price: '按秒计费', desc: 'Alrc 中转 · 旗舰画质' },
  { id: 'doubao-seedance-2', label: 'Seedance 2', color: '#8B5CF6', price: '按秒计费', desc: 'Alrc 中转 · 1080p 标准' },
  { id: 'doubao-seedance-2-fast', label: 'Seedance 2 Fast', color: '#A78BFA', price: '按秒计费 · 更省', desc: 'Alrc 中转 · 720p 快速' },
  { id: 'doubao-seedance-2-mini', label: 'Seedance 2 Mini', color: '#C4B5FD', price: '按秒计费 · 最省', desc: 'Alrc 中转 · 480p 轻量' },
];

// ===== 免费模型内置列表 =====
const FREE_MODELS = [
  { id: 'agentai', label: '岐枢 | Agnes Free (Flash)', envVar: 'AGENTAI_API_KEY', baseURL: 'https://api.agnes-ai.cn/v1', color: '#4F46E5' },
  { id: 'zhipu', label: '智谱 GLM-4.7 Flash', envVar: 'ZHIPU_API_KEY', baseURL: 'https://open.bigmodel.cn/api/paas/v4', color: '#3B82F6' },
];

// ===== 多媒体引擎密钥 (生视频/生图) =====
const MEDIA_ENGINES = [
  { id: 'agnes-video', label: 'Agnes Video 2.5 正式版', envVar: 'AGNES_VIDEO_API_KEY', baseURL: 'https://apihub.agnes-ai.cn/v1', color: '#4F46E5', desc: '支持图生视频/首尾帧/参考模式, 独立密钥', docsUrl: 'https://platform.agnes-ai.cn' },
  { id: 'doubao', label: '火山引擎/豆包 (Seedance 2.5)', envVar: 'VOLCANO_API_KEY', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', color: '#FF7A45', desc: 'Seedance 2.5 1080p 视频生成', docsUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
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
  
  // ALRC 聚合平台
  // 2026-10-13 修复「填入密钥不会缓存」: factoryKeys 原是 useState({}) 纯内存态,
  //   组件卸载/刷新即丢。现在挂载时从三处已落盘来源回填 (优先级 本地 secureKeyStorage
  //   > modelStore 持久层 > 空), 保存时 saveApiKeyToGateway 会写回这三处 (见 :464), 闭环成立。
  const [factoryKeys, setFactoryKeys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of FACTORY_KEY_GROUPS) {
      init[g.envVar] = getApiKey(g.envVar) || commercialKeys[g.envVar] || '';
    }
    return init;
  });
  // 2026-10-19: 单主令牌模式 —— 一把 ALRC_API_KEY 全权限令牌覆盖 ALRO 全部分组。
  //   ALRO 已合并为「全权限单令牌」, 用户只需在此填一把令牌, 点「应用并填充全部分组」
  //   即自动写入 ALRC_API_KEY + 全部 FACTORY_*_KEY (覆盖旧的分组密钥), 无需分别粘贴 6 次。
  const [masterKey, setMasterKey] = useState<string>(() =>
    getApiKey('ALRC_API_KEY') || (commercialKeys as Record<string, string>)['ALRC_API_KEY'] || ''
  );
  const [savingMaster, setSavingMaster] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({});
  const [alrcExpanded, setAlrcExpanded] = useState(false); // ALRC 子模型列表折叠状态
  
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
      ...MEDIA_ENGINES.map(m => ({ id: m.id, envVar: m.envVar })),
      ...MODEL_TEMPLATES.map(t => ({ id: t.id, envVar: `${t.id.toUpperCase()}_API_KEY` })),
      { id: 'alrc', envVar: 'ALRC_API_KEY' },
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
  const saveApiKeyToGateway = async (providerId: string, apiKey: string, envVarOverride?: string) => {
    try {
      const r = await fetch(httpUrl() + '/v1/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey }),
      });
      if (r.ok) {
        message.success(`✅ ${providerId} Key 已保存`);
        // 同时缓存到本地（用 sessionStorage 替代 localStorage，关闭浏览器自动销毁）
        const envVar = envVarOverride || `${providerId.toUpperCase()}_API_KEY`;
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

  /** 启用模板关联的所有模型 (主模型 + extraModelIds); 不存在的 id 静默跳过 */
  const toggleTemplateModels = (template: ModelTemplate, enabled: boolean) => {
    const store = useModelStore.getState();
    for (const id of [template.id, ...(template.extraModelIds || [])]) {
      const m = models.find(x => x.id === id);
      if (m && m.enabled !== enabled) store.toggleModel(id, enabled);
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
<SettingOutlined style={{ fontSize: 'var(--fs-lg)', color: 'var(--accent)' }} />
<span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>岐枢设置</span>
</div>

      <Tabs
        defaultActiveKey="models"
        items={[
          // ========== 通用设置 ==========
          {
            key: 'general',
            label: <span><AppstoreOutlined /> 通用</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Divider style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: 0 }}>通知提醒</Divider>
                  {/* ... desktop notify ... */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}><BellOutlined /> 桌面通知</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>任务完成时弹出桌面通知 (需浏览器权限)</Text>
                    </div>
                    <Switch checked={desktopNotify} onChange={(v) => { setDesktopNotify(v); taskNotifier.setDesktopEnabled(v); }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}><SoundOutlined /> 提示音</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>任务完成时播放提示音</Text>
                    </div>
                    <Switch checked={soundNotify} onChange={(v) => { setSoundNotify(v); taskNotifier.setSoundEnabled(v); }} />
                  </div>

                  <Divider style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: 0 }}>语音</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}><SoundOutlined /> AI 回复语音播报</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>AI 回复完成时自动朗读</Text>
                    </div>
                    <Switch checked={ttsEnabled} onChange={(v) => { setTtsEnabledState(v); setTtsEnabled(v); }} />
                  </div>
                  
                  {/* 音色选择 */}
                  {ttsEnabled && (
                    <div style={{ marginTop: 12, marginLeft: 24 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted-2)', marginBottom: 8 }}>选择音色</div>
                      <VoiceSelector />
                    </div>
                  )}

                  <Divider style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: 0 }}>自动化</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}>🤖 自动恢复</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>AI 意外中止时自动发送 continue 恢复任务</Text>
                    </div>
                    <Switch checked={autoResume} onChange={(v) => { setAutoResume(v); localStorage.setItem('agentai.settings.autoResume', JSON.stringify(v)); }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}>💬 追问卡片</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>AI 遇到不明确需求时触发审批卡片让用户确认</Text>
                    </div>
                    <Switch defaultChecked onChange={(v) => localStorage.setItem('agentai.settings.askUser', JSON.stringify(v))} />
                  </div>

                  <Divider style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: 0 }}>模式设置</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}>🔮 默认模式</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>新会话启动时的默认运行模式</Text>
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
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}>💡 智能模式推荐</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>根据消息内容自动推荐更合适的模式</Text>
                    </div>
                    <Switch checked={recommendEnabled} onChange={(v) => setRecommendEnabled(v)} />
                  </div>

                  <Divider style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', margin: 0 }}>存储</Divider>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)' }}>💾 自动记忆</div>
                      <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>对话完成时自动保存到 MemoryEngine</Text>
                    </div>
                    <Switch defaultChecked onChange={(v) => localStorage.setItem('agentai.settings.autoMemory', JSON.stringify(v))} />
                  </div>
                  <Alert type="info" message="以上设置立即生效, 无需重启" style={{ fontSize: 'var(--fs-micro)' }} />
                </Space>
              </Card>
            ),
          },

          // ========== 模型配置 (免费 + 商用) ==========
          {
            key: 'models',
            label: <span><ApiOutlined /> 模型</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={20}>
                  
                  {/* ===== 免费模型区域 ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 'var(--fs-md)', color: 'var(--success)', margin: 0 }}>
                      <ThunderboltOutlined style={{ color: 'var(--success)', marginRight: 6 }} />
                      免费模型 (内置, 无需配置)
                    </Divider>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                      {FREE_MODELS.map(m => {
                        const status = allKeyStatus[m.id];
                        return (
                          <div key={m.id} style={{
                            padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                            background: 'var(--panel)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <Space>
                              <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                              <Text strong style={{ color: 'var(--fg)' }}>{m.label}</Text>
                              <Tag color="green">免费</Tag>
                              <code style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{m.baseURL}</code>
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
                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 8, paddingLeft: 4 }}>
                      <ThunderboltOutlined /> 免费模型可用于主对话和子任务，自动切换，无速率限制担忧
                    </div>
                  </div>

                  {/* ===== 多媒体引擎密钥区域 ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 'var(--fs-md)', color: '#8B5CF6', margin: 0 }}>
                      <VideoCameraOutlined style={{ color: '#8B5CF6', marginRight: 6 }} />
                      视频生成引擎 (独立密钥)
                    </Divider>
                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 8, marginBottom: 12 }}>
                      Agnes Video 2.5 正式版使用独立密钥, 与 Flash 对话密钥分开配置。配置后在「生视频」页面选择对应模型即可使用。
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {MEDIA_ENGINES.map(m => {
                        const status = allKeyStatus[m.id];
                        return (
                          <div key={m.id} style={{
                            padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                            background: 'var(--panel)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Space>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                                <Text strong style={{ color: 'var(--fg)' }}>{m.label}</Text>
                              </Space>
                              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4, marginLeft: 20 }}>
                                {m.desc} · <code style={{ fontSize: 'var(--fs-micro)' }}>{m.baseURL}</code>
                              </div>
                            </div>
                            <Space>
                              {status?.ok
                                ? <Tag color="success">✓ 已配置 ({status.masked})</Tag>
                                : <Tag color="warning">⚠ 未配置</Tag>
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
                                    if (await saveApiKeyToGateway(m.id, editApiKey, m.envVar)) setEditingProvider(null);
                                  }}>保存</Button>
                                  <Button size="small" onClick={() => setEditingProvider(null)}>取消</Button>
                                </Space.Compact>
                              ) : (
                                <Space>
                                  {m.docsUrl && <Button size="small" type="link" href={m.docsUrl} target="_blank" icon={<LinkOutlined />}>获取密钥</Button>}
                                  <Button size="small" type="link" onClick={() => { setEditingProvider(m.id); setEditApiKey(''); }}>
                                    配置 Key
                                  </Button>
                                </Space>
                              )}
                            </Space>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ===== 模型工厂 (ALRC 聚合平台) ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 'var(--fs-md)', color: 'var(--violet)', margin: 0 }}>
                      <ApiOutlined style={{ color: 'var(--violet)', marginRight: 6 }} />
                      模型工厂 (一个密钥解锁全部 AI 能力)
                    </Divider>

                    <Alert
                      type="info"
                      style={{ marginTop: 8, marginBottom: 12, fontSize: 'var(--fs-sm)' }}
                      message={
                        <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.8 }}>
                          <div>模型工厂接入 GPT-5、Claude、Grok、豆包等顶级模型，支持对话、生图、生视频等多种能力。</div>
                          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--accent)' }}>
                            <b>🔑 如何获取密钥？</b><br/>
                            添加作者微信 <b>agentai-platform</b> 获取密钥，填入后即可解锁全部模型。
                          </div>
                        </div>
                      }
                    />

                    {/* 2026-10-19: 单主令牌入口 —— 一把 ALRC_API_KEY 解锁全部模型 */}
                    <div style={{ marginBottom: 14, padding: 12, background: 'var(--bg-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--fg-2)' }}>🔑 主令牌 (ALRC_API_KEY)</span>
                        <Tag color="purple" style={{ fontSize: 'var(--fs-micro)' }}>一把令牌解锁全部</Tag>
                      </div>
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginBottom: 8, lineHeight: 1.7 }}>
                        ALRO 现已合并为「全权限单令牌」。只需在此填入一把全权限令牌，点击右侧按钮即可自动填充到下方全部 6 个分组（覆盖旧的分组密钥），无需分别粘贴。重启网关后，启动日志的 ALRO 分组探测应全部显示 ✅。
                      </div>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input.Password
                          value={masterKey}
                          onChange={e => setMasterKey(e.target.value)}
                          placeholder="sk-... 全权限令牌"
                          style={{ flex: 1 }}
                        />
                        <Button
                          type="primary"
                          icon={savingMaster ? <LoadingOutlined /> : <ThunderboltOutlined />}
                          disabled={!masterKey.trim()}
                          loading={savingMaster}
                          onClick={async () => {
                            const key = masterKey.trim();
                            if (!key) { message.warning('请输入主令牌'); return; }
                            setSavingMaster(true);
                            try {
                              // 1) 主令牌本身 (网关 ENV_KEY_MAP['alrc'] || ALRC_API_KEY)
                              await saveApiKeyToGateway('alrc', key, 'ALRC_API_KEY');
                              // 2) 同步填充到全部分组 (覆盖旧密钥, 确保任意路由路径都走这把令牌)
                              for (const g of FACTORY_KEY_GROUPS) {
                                setFactoryKeys(prev => ({ ...prev, [g.envVar]: key }));
                                await saveApiKeyToGateway(`factory-${g.id}`, key, g.envVar);
                              }
                              message.success('✅ 主令牌已应用到全部分组，重启网关后生效');
                            } finally {
                              setSavingMaster(false);
                            }
                          }}
                        >
                          应用并填充全部分组
                        </Button>
                      </Space.Compact>
                    </div>

                    {/* 模型工厂: 按分组显示密钥+模型列表 */}
                    <div style={{ marginBottom: 12 }}>
                      {FACTORY_KEY_GROUPS.map(group => {
                        // 获取该分组的模型列表
                        const groupModels = group.id === 'chat' ? FACTORY_MODEL_LIST
                          : group.id === 'image' ? FACTORY_IMAGE_MODEL_LIST
                          : group.id === 'video' ? FACTORY_VIDEO_MODEL_LIST
                          : []; // GPT/Claude/Grok 分组: 服务端尚未分配模型, 显示占位
                        const hasKey = !!factoryKeys[group.envVar]?.trim();
                        const isExpanded = !!groupExpanded[group.id];
                        return (
                          <div key={group.id} style={{ marginBottom: 12, padding: 10, background: 'var(--bg-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                            {/* 分组标题 + 密钥输入 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: group.color, display: 'inline-block' }} />
                              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg-2)' }}>{group.label}</span>
                              <span style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>{group.desc}</span>
                            </div>
                            <Space.Compact style={{ width: '100%' }}>
                              <Input.Password
                                value={factoryKeys[group.envVar] || ''}
                                onChange={e => setFactoryKeys(prev => ({ ...prev, [group.envVar]: e.target.value }))}
                                placeholder={`输入${group.label}...`}
                                style={{ flex: 1 }}
                              />
                              <Button
                                type="primary"
                                size="small"
                                icon={testingKey === group.envVar ? <LoadingOutlined /> : <CheckOutlined />}
                                onClick={async () => {
                                  const key = factoryKeys[group.envVar]?.trim();
                                  if (!key) { message.warning('请输入密钥'); return; }
                                  setTestingKey(group.envVar);
                                  // 2026-10-13: video 测试模型由 seedance-1.0-lite (已不存在于 Alrc Seedance 分组)
                                  // 改为真实的 doubao-seedance-2.5, 否则「验证」恒报 model_not_found。
                                  const testModel = group.id === 'chat' ? 'deepseek-flash' : group.id === 'image' ? 'nano-banana' : group.id === 'video' ? 'doubao-seedance-2.5' : group.id;
                                  const ok = await testConnection('https://alro.huazhiweilai.com/v1', key, testModel, `factory-${group.id}`);
                                  setTestingKey(null);
                                  if (ok) {
                                    // 2026-10-13 修复: 原代码硬编码 saveApiKeyToGateway('factory', key)
                                    //   ⇒ 6 个分组全写同一个 envVar (回落成 FACTORY_API_KEY, 而无人读它),
                                    //     后填的分组覆盖先填的, 且 router 侧 FACTORY_*_KEY 永远是空。
                                    // 现在按分组传各自的 provider, 并显式传 envVarOverride 让本地缓存对齐。
                                    await saveApiKeyToGateway(`factory-${group.id}`, key, group.envVar);
                                    (useSubscriptionStore as any).getState().activateWithKey();
                                    message.success(`${group.label} 验证成功`);
                                  }
                                }}
                                loading={testingKey === group.envVar}
                              >
                                验证
                              </Button>
                            </Space.Compact>

                            {/* 该分组的模型列表 (可折叠) */}
                            {groupModels.length > 0 && (
                              <>
                                <div
                                  style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8, cursor: 'pointer', userSelect: 'none' }}
                                  onClick={() => setGroupExpanded(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                                >
                                  {isExpanded ? '▼' : '▶'} {groupModels.length} 个模型 (启用后出现在选择器中)
                                </div>
                                {isExpanded && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                                    {groupModels.map((m: any) => {
                                      // 2026-10-13 修复: 原代码 `models.find(x => x.id === \`factory-${m.id}\`)`。
                                      // 但本清单的 id 是**裸模型名**(deepseek-flash / MiniMax-M2.5),
                                      // 而 modelStore 里的 id 是 **factory- 前缀 + 小写化**(factory-minimax-m2.5),
                                      // 两者拼法对不上 ⇒ isEnabled 恒false、toggleModel('factory-MiniMax-M2.5')
                                      // 命中不存在的 id ⇒ "启用"按钮点了完全没反应。
                                      // 现在改为按 models[] 里的真实 API 模型名反查 —— 那个字段才是发给上游的,
                                      // 与 id 的大小写/分隔符写法无关(不能靠 groupLabel 判, 对话组叫"国内·DeepSeek")。
                                      const modelInStore = models.find(
                                        (x) => x.provider === 'alrc' && x.models?.includes(m.id)
                                      );
                                      const isEnabled = modelInStore?.enabled ?? false;
                                      return (
                                        <div key={m.id} style={{
                                          display: 'flex', alignItems: 'center', gap: 8,
                                          padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                          background: 'var(--bg)', border: isEnabled ? `1px solid ${group.color}` : '1px solid var(--border)',
                                        }}>
                                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--fg-2)' }}>
                                              {m.label}
                                              {isEnabled && <Tag style={{ marginLeft: 4, fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 4px' }} color="purple">已启用</Tag>}
                                            </div>
                                            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                                              {'priceIn' in m
                                                ? `输入 ${m.priceIn}/1M · 输出 ${m.priceOut}/1M`
                                                  + (m.priceCacheRead ? ` · 缓存读 ${m.priceCacheRead}/1M` : '')
                                                  + (m.priceCacheCreate ? ` · 缓存写 ${m.priceCacheCreate}/1M` : '')
                                                : `按次 ${m.price}`}
                                              {m.level && <span> · <Tag style={{ fontSize: 'var(--fs-micro)', lineHeight: '14px', padding: '0 4px' }}>{m.level}</Tag></span>}
                                            </div>
                                          </div>
                                          <Button
                                            size="small"
                                            type={isEnabled ? 'primary' : 'default'}
                                            icon={isEnabled ? <CheckOutlined /> : <ApiOutlined />}
                                            disabled={!hasKey}
                                            onClick={() => modelInStore && useModelStore.getState().toggleModel(modelInStore.id, !isEnabled)}
                                            style={{ fontSize: 'var(--fs-micro)' }}
                                          >
                                            {isEnabled ? '已启用' : '启用'}
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                            {groupModels.length === 0 && hasKey && (
                              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                                ⏳ 该分组模型列表将从服务端动态加载
                              </div>
                            )}
                            {groupModels.length === 0 && !hasKey && (
                              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)' }}>
                                🔒 填入密钥后显示可用模型
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ===== 商用模型区域 (备选接入方案) ===== */}
                  <div>
                    <Divider orientation="left" style={{ fontSize: 'var(--fs-md)', color: 'var(--warning)', margin: 0 }}>
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
                                <code style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{t.baseURL}</code>
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
                                <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>可用模型: </Text>
                                {t.models.map((m, i) => (
                                  <Tag key={m} style={{ fontSize: 'var(--fs-micro)', marginRight: 4 }}>
                                    {m}
                                  </Tag>
                                ))}
                              </div>
                              <div style={{ marginBottom: 8 }}>
                                <Text type="secondary" style={{ fontSize: 'var(--fs-micro)' }}>
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
                    <Divider orientation="left" style={{ fontSize: 'var(--fs-md)', color: 'var(--muted)', margin: 0 }}>
                      <PlusOutlined style={{ marginRight: 6 }} />
                      自定义模型 (任意 OpenAI 兼容 API)
                    </Divider>
                    
                    {/* 已添加的自定义模型列表 */}
                    {models.filter(m => !m.isBuiltIn).length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>已添加的模型:</div>
                        {/* 按类型分组显示 */}
                        {(['image', 'video', 'chat'] as const).map(type => {
                          const typeModels = models.filter(m => !m.isBuiltIn && m.modelType === type);
                          if (typeModels.length === 0) return null;
                          const typeLabel = type === 'image' ? '🎨 图像模型' : type === 'video' ? '🎬 视频模型' : '💬 文本模型';
                          const typeColor = type === 'image' ? '#EC4899' : type === 'video' ? '#8B5CF6' : '#3B82F6';
                          return (
                            <div key={type} style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: typeColor, marginBottom: 6 }}>{typeLabel}</div>
                              {typeModels.map((m, idx) => (
                                <div key={m.id} style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                  background: 'var(--bg-2)', border: '1px solid var(--border)', marginBottom: 6,
                                }}>
                                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--fg-2)' }}>{m.label}</div>
                                    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.baseURL}</div>
                                  </div>
                                  <Button
                                    size="small"
                                    icon={<CheckCircleOutlined />}
                                    onClick={() => testConnection(m.baseURL, getApiKey(m.apiKeyEnv) || commercialKeys[m.apiKeyEnv] || '', m.models?.[0] || m.label, `custom-${idx}`)}
                                    loading={testingId === `custom-${idx}`}
                                    style={{ fontSize: 'var(--fs-micro)' }}
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
                                  }} style={{ fontSize: 'var(--fs-micro)' }} />
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* P2: 自定义模型表单改为折叠, 默认收起 */}
                    <Collapse
                      ghost
                      size="small"
                      style={{ marginTop: 8 }}
                      items={[{
                        key: 'add-form',
                        label: <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}><PlusOutlined style={{ marginRight: 4 }} />添加新的自定义模型</span>,
                        children: (
                    <Form layout="vertical" size="small" style={{ marginTop: 4 }}>
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
                        ),
                      }]}
                    />
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
                  <div style={{ padding: '16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <ThunderboltOutlined style={{ color: 'var(--warning)' }} />
                        <Text strong>DeepSeek Flash (V4.1)</Text>
                        <Tag color="orange">付费</Tag>
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>强力推理, 适合代码审查/架构/安全</span>
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
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 4 }}>
                    💡 提示: 配置 DeepSeek Key 后, 当你执行代码审查、架构设计、安全分析等任务时, AI 会自动建议切换到 DeepSeek Flash (V4.1)。你也可以随时在模型选择器中手动切换。
                  </div>
                </Space>
              </Card>
            ),
          },

          // ========== 框架切换 ==========
          {
            key: 'framework',
            label: <span><ThunderboltOutlined /> 框架</span>,
            children: (
              <Card>
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <div>
                    <div style={{ color: 'var(--muted)', marginBottom: 8 }}>当前框架</div>
                    <Space>
                      <Button type={active === 'agentai' ? 'primary' : 'default'} onClick={() => setActive('agentai')}>AgentAI (自研主框架)</Button>
                      <Button type={active === 'pulseflow' ? 'primary' : 'default'} onClick={() => setActive('pulseflow')} style={active === 'pulseflow' ? { background: '#9333EA', borderColor: '#9333EA' } : undefined}>PulseFlow (强注入防御)</Button>
                    </Space>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted)' }}>A/B 灰度: {(abRatio * 100).toFixed(0)}% → {active}</div>
                    <input type="range" min={0} max={1} step={0.05} value={abRatio} onChange={(e) => setAbRatio(parseFloat(e.target.value))} style={{ width: '100%' }} />
                  </div>
                  <Alert type="info" message="关于框架" description={<ul style={{ marginBottom: 0, paddingLeft: 18 }}><li>AgentAI: 自研主框架, 并行工具 + 多智能体, 适合代码/工具调用</li><li>PulseFlow: 4 段式提示 + 中文注入强防御, 适合高风险对话</li><li>A/B 灰度: 1.0 = 全走 AgentAI, 0.0 = 全走 PulseFlow</li><li>切换后新建对话即生效, 无需重启</li></ul>} />
                  <Divider />
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>⚙️ 灰度功能开关</div>
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>新模型选择器 <Tag style={{ fontSize: 'var(--fs-micro)' }}>useNewModelSelector</Tag></span>
                        <Switch checked={featureFlags.useNewModelSelector} onChange={(v) => setFeatureFlags(f => ({ ...f, useNewModelSelector: v }))} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>诊断优先主链路 <Tag style={{ fontSize: 'var(--fs-micro)' }}>enableDiagnosisPipeline</Tag></span>
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
                    {qqStatus.sessionId && <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Session: {qqStatus.sessionId}</span>}
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
                <div style={{ marginBottom: 12, fontSize: 'var(--fs-sm)', color: 'var(--muted-2)' }}>
                  AI 会跨会话学习你的偏好和教训, 越用越懂你。这里可以查看和管理 AI 学到的内容。
                </div>
                <EvolutionPanel />
              </Card>
            ),
          },

          // ========== MCP 配置 ==========
          {
            key: 'mcp',
            label: <span><ApiOutlined /> MCP</span>,
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
            label: <span><SyncOutlined /> 更新</span>,
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
                  <Descriptions.Item label="框架">自研双适配器: AgentAI + PulseFlow</Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },
        ].filter(tab => {
          // P0 优化: 隐藏空壳/低价值 tab — 保留核心功能
          const HIDDEN_TABS = ['sandbox', 'evolution', 'pro-recommend', 'qq'];
          return !HIDDEN_TABS.includes(tab.key as string);
        })}
      />
    </div>
  );
};
