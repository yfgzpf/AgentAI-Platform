/**
 * Connectors API — 外部连接器管理 + AI自主驱动安装/配置
 * ============================================================
 * 
 * 核心理念：用户一键启用 → AI自动检测 → 缺什么装什么 → 缺配置就追问用户 → 填好即用
 * 
 * 每个连接器包含完整的自检、安装、配置、验证流程，全部由 AI 通过工具调用驱动。
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, ExecOptions, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ConnectorMeta {
  id: string;
  name: string;
  category: 'device' | 'service' | 'automation';
  description: string;
  dependencies: Array<{
    check: string;
    install?: Record<'win' | 'mac' | 'linux', string[]>;
    description: string;
    platform?: 'all' | 'win' | 'mac' | 'linux';
  }>;
  configItems: Array<{
    key: string;
    label: string;
    placeholder: string;
    required: boolean;
    hint: string;
    defaultValue?: string;
  }>;
  healthCheck?: string;
}

type PlatformCommands = Record<'win' | 'mac' | 'linux', string[]>;

interface ConnectorState {
  enabled: boolean;
  status: 'offline' | 'online' | 'configuring' | 'error';
  installed: boolean;
  configured: boolean;
  missingDeps: string[];
  missingConfig: string[];
  lastError?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.agentai', 'connectors');
try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}

function loadConnectorStates(): Record<string, ConnectorState> {
  const CONFIG_FILE = path.join(CONFIG_DIR, 'states.json');
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) { console.warn('[connector] Failed to load states:', e); }
  
  const states: Record<string, ConnectorState> = {};
  for (const meta of CONNECTORS) {
    states[meta.id] = { enabled: false, status: 'offline', installed: false, configured: false, missingDeps: meta.dependencies.map(d => d.check), missingConfig: meta.configItems.filter(c => c.required).map(c => c.key) };
  }
  saveConnectorStates(states);
  return states;
}

function saveConnectorStates(states: Record<string, ConnectorState>) {
  try { fs.writeFileSync(path.join(CONFIG_DIR, 'states.json'), JSON.stringify(states, null, 2), 'utf-8'); } catch (e) { console.warn('[connector] Failed to save states:', e); }
}

async function checkCommand(cmd: string): Promise<boolean> {
  try { await execAsync(cmd, { timeout: 5000 }); return true; } catch { return false; }
}

function getInstallCommandsForPlatform(dep: ConnectorMeta['dependencies'][0]): string[] {
  const platformKey = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  if (dep.install && typeof dep.install === 'object' && !Array.isArray(dep.install)) {
    return dep.install[platformKey] || (dep.install as any).all || [];
  }
  if (Array.isArray(dep.install)) return dep.install;
  return [];
}

async function installDependency(meta: ConnectorMeta, depIndex: number): Promise<{ success: boolean; remaining: string[] }> {
  const dep = meta.dependencies[depIndex];
  const installCmds = getInstallCommandsForPlatform(dep);
  if (installCmds.length === 0) return { success: true, remaining: meta.dependencies.map(d => d.check) };
  for (const installCmd of installCmds) {
    try { await execAsync(installCmd, { timeout: 120000 }); return { success: true, remaining: meta.dependencies.map(d => d.check) }; }
    catch (e) { console.log(`[connector] install attempt failed: ${installCmd}, trying next...`); }
  }
  return { success: false, remaining: meta.dependencies.map(d => d.check) };
}

const CONNECTORS: ConnectorMeta[] = [
  { id: 'android', name: 'Android 手机', category: 'device', description: '通用手机自动化 — AI操作微信/抖音/小红书/快手等任何App', dependencies: [{ check: 'adb version', install: { win: ['winget install Android.Tools.ADB'], mac: ['brew install android-platform-tools'], linux: ['sudo apt install android-platform-tools'] }, description: 'Android Debug Bridge — USB调试必需', platform: 'all' }, { check: 'curl -s http://localhost:7070/mcp', install: { win: ['从 https://github.com/Zfinix/another/releases 下载 Windows MSI'], mac: ['从 https://github.com/Zfinix/another/releases 下载 DMG'], linux: ['从 https://github.com/Zfinix/another/releases 下载 AppImage'] }, description: 'Another MCP Server — 提供手机控制接口', platform: 'all' }], configItems: [{ key: 'device_serial', label: '设备序列号', placeholder: 'adb devices查看的序列号', required: false, hint: 'USB连接后运行 "adb devices"，第一列为序列号，留空则自动检测' }], healthCheck: 'adb devices | grep device && curl -s http://localhost:7070/mcp' },
  { id: 'wechat-automation', name: '公众号运营', category: 'automation', description: 'AI全自动运营公众号: 对标→写稿→deAI→质量闸门→配图→发布草稿箱', dependencies: [{ check: 'python3 --version', install: { win: ['从 python.org 下载安装包勾选 PATH'], mac: ['brew install python3'], linux: ['sudo apt install python3 python3-pip'] }, description: 'Python 3.8+ — 运行脚本', platform: 'all' }], configItems: [{ key: 'deepseek_api_key', label: 'DeepSeek API Key', placeholder: 'sk-xxxxxxxxxxxx', required: true, hint: '去 https://platform.deepseek.com 注册获取', defaultValue: '' }, { key: 'wechat_appid', label: '公众号 AppID', placeholder: 'wx1234567890', required: true, hint: 'mp.weixin.qq.com → 开发 → 基本配置', defaultValue: '' }, { key: 'wechat_appsecret', label: '公众号 AppSecret', placeholder: 'xxxxxxxxxx', required: true, hint: '同上，注意保密，不要泄露', defaultValue: '' }, { key: 'image_api_key', label: '出图API Key (可选)', placeholder: 'runware-key', required: false, hint: 'Runware: runware.ai / 豆包: volcengine.com', defaultValue: '' }], healthCheck: 'curl -s https://api.deepseek.com/chat/completions -H "Authorization: Bearer $DEEPSEEK_KEY"' },
  { id: 'sketchup', name: 'SketchUp建模', category: 'device', description: 'AI直接操控SketchUp进行建模操作(建筑/室内/家具设计)', dependencies: [{ check: 'which uv || command -v uv', install: { win: ['winget install --id astral-sh.uv -e'], mac: ['brew install uv'], linux: ['cargo install uv'] }, description: 'uv — 包管理器', platform: 'all' }], configItems: [{ key: 'sketchup_version', label: 'SketchUp版本', placeholder: '2024+', required: true, hint: '必须2024及以上版本', defaultValue: '' }, { key: 'mcp_port', label: 'MCP端口', placeholder: '9876', required: false, hint: '默认9876，仅限本机', defaultValue: '9876' }], healthCheck: 'tasklist | findstr sketchup' },
  { id: 'browser', name: '浏览器控制', category: 'automation', description: 'AI操控浏览器 — 自动浏览网页、填表、截图、提取数据', dependencies: [], configItems: [], healthCheck: '' },
  { id: 'qq-bot', name: 'QQ Bot', category: 'service', description: 'AI通过QQ接收消息并自动回复', dependencies: [], configItems: [{ key: 'qq_account', label: 'QQ号', placeholder: '123456789', required: true, hint: '使用备用号勿用主号', defaultValue: '' }, { key: 'ws_reverse_url', label: 'WebSocket地址', placeholder: 'ws://127.0.0.1:18790/ws', required: true, hint: '指向Gateway的WS地址', defaultValue: '' }], healthCheck: '' },
  { id: 'tts', name: '语音播报TTS', category: 'service', description: 'AI回复自动语音朗读', dependencies: [], configItems: [{ key: 'tts_voice', label: '音色', placeholder: 'default', required: false, hint: '可选: default/female/male', defaultValue: 'default' }], healthCheck: '' },
  { id: 'wake-word', name: '语音唤醒', category: 'device', description: '随时语音唤醒AI助手', dependencies: [{ check: 'arecord -l 2>/dev/null || ioreg', install: { win: ['设置中确认麦克风可用'], mac: ['系统偏好设置允许麦克风访问'], linux: ['安装 pulseaudio'] }, description: '麦克风硬件', platform: 'all' }], configItems: [{ key: 'wake_word', label: '唤醒词', placeholder: '你好AgentAI', required: false, hint: '建议2-4个汉字', defaultValue: '你好AgentAI' }], healthCheck: '' },
  { id: 'music', name: '音乐播放', category: 'service', description: 'AI根据对话推荐播放音乐', dependencies: [], configItems: [], healthCheck: '' },
  { id: 'git', name: 'Git版本控制', category: 'service', description: 'AI自动提交代码、创建分支、推送', dependencies: [{ check: 'git --version', install: { win: ['从 git-scm.com 下载'], mac: ['brew install git'], linux: ['sudo apt install git'] }, description: 'Git版本控制工具', platform: 'all' }], configItems: [{ key: 'git_user_name', label: 'Git用户名', placeholder: 'Your Name', required: true, hint: 'git config user.name', defaultValue: '' }, { key: 'git_user_email', label: 'Git邮箱', placeholder: 'you@example.com', required: true, hint: 'git config user.email', defaultValue: '' }, { key: 'git_ssh_key', label: 'SSH密钥路径', placeholder: '~/.ssh/id_ed25519', required: false, hint: '推送到远程时需要', defaultValue: '' }], healthCheck: 'git config --get user.name' }
];

export function createConnectorsRouter(): Router {
  const router = Router();
  let states = loadConnectorStates();

  // 健康检查缓存
  const healthCache = new Map<string, { status: boolean; ts: number }>();
  const HEALTH_CACHE_TTL = 30000; // 30秒缓存

  async function checkConnectorHealth(meta: ConnectorMeta, state: ConnectorState): Promise<{ healthy: boolean; details: string }> {
    if (!state.enabled) return { healthy: false, details: '未启用' };
    if (!meta.healthCheck) return { healthy: true, details: '无健康检查' };
    
    // 检查缓存
    const cached = healthCache.get(meta.id);
    if (cached && Date.now() - cached.ts < HEALTH_CACHE_TTL) {
      return { healthy: cached.status, details: '缓存结果' };
    }

    try {
      await execAsync(meta.healthCheck, { timeout: 10000 });
      healthCache.set(meta.id, { status: true, ts: Date.now() });
      return { healthy: true, details: '健康检查通过' };
    } catch (e: any) {
      healthCache.set(meta.id, { status: false, ts: Date.now() });
      return { healthy: false, details: e.message || '健康检查失败' };
    }
  }

  router.get('/status', async (_req, res) => {
    const result: Record<string, any> = {};
    for (const meta of CONNECTORS) {
      const state = states[meta.id] || { enabled: false, status: 'offline', installed: false, configured: false, missingDeps: [], missingConfig: [] };
      const actualMissingDeps = meta.dependencies.map(d => d.check);
      const actualMissingConfig = meta.configItems.filter(c => c.required).map(c => c.key);
      
      // 实时健康检查
      const health = await checkConnectorHealth(meta, state);
      if (state.enabled && health.healthy && state.status !== 'online') {
        state.status = 'online';
        states[meta.id] = state;
        saveConnectorStates(states);
      } else if (state.enabled && !health.healthy && state.status === 'online') {
        state.status = 'error';
        state.lastError = health.details;
        states[meta.id] = state;
        saveConnectorStates(states);
      }
      
      result[meta.id] = { 
        ...state, 
        name: meta.name, 
        category: meta.category, 
        description: meta.description, 
        dependencies: meta.dependencies, 
        configItems: meta.configItems, 
        needsInstall: state.enabled && !state.installed && actualMissingDeps.length > 0, 
        needsConfig: state.enabled && !state.configured && actualMissingConfig.length > 0, 
        readyToUse: state.enabled && state.installed && state.configured && state.status === 'online', 
        missingDeps: actualMissingDeps, 
        missingConfig: actualMissingConfig,
        health: health.healthy,
        healthDetails: health.details,
      };
    }
    res.json(result);
  });

  router.post('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const meta = CONNECTORS.find(c => c.id === id);
    if (!meta) return res.status(404).json({ ok: false, error: `Unknown connector: ${id}` });
    const enabled = !!req.body.enabled;
    const state = states[id] || { enabled: false, status: 'offline', installed: false, configured: false, missingDeps: [], missingConfig: [] };
    if (enabled) {
      if (meta.dependencies.length > 0 || meta.configItems.some(c => c.required)) { state.status = 'configuring'; console.log(`[connectors] ${meta.name} 已请求启用，检测到缺失依赖/配置，AI将自动处理`); } else { state.status = 'online'; console.log(`[connectors] ${meta.name} 已启用（无需额外配置）`); }
      state.enabled = true;
    } else { state.enabled = false; state.status = 'offline'; console.log(`[connectors] ${meta.name} 已禁用`); }
    states[id] = state;
    saveConnectorStates(states);
    res.json({ ok: true, id, enabled, status: state.status, message: state.status === 'configuring' ? `${meta.name} 正在配置中...AI将自动安装依赖并收集必要配置。请等待或查看AI的建议。` : `${meta.name} 已启用`, missingDeps: meta.dependencies.map(d => d.check), missingConfig: meta.configItems.filter(c => c.required).map(c => c.key) });
  });

  // 前端使用的 toggle 路由 (别名)
  router.post('/toggle', (req: Request, res: Response) => {
    const { id, enabled } = req.body;
    const meta = CONNECTORS.find(c => c.id === id);
    if (!meta) return res.status(404).json({ ok: false, error: `Unknown connector: ${id}` });
    const state = states[id] || { enabled: false, status: 'offline', installed: false, configured: false, missingDeps: [], missingConfig: [] };
    if (enabled) {
      if (meta.dependencies.length > 0 || meta.configItems.some(c => c.required)) { state.status = 'configuring'; console.log(`[connectors] ${meta.name} 已请求启用，检测到缺失依赖/配置，AI将自动处理`); } else { state.status = 'online'; console.log(`[connectors] ${meta.name} 已启用（无需额外配置）`); }
      state.enabled = true;
    } else { state.enabled = false; state.status = 'offline'; console.log(`[connectors] ${meta.name} 已禁用`); }
    states[id] = state;
    saveConnectorStates(states);
    res.json({ ok: true, id, enabled, status: state.status });
  });

  router.post('/install-dependency', (req: Request, res: Response) => {
    const { connectorId, depIndex } = req.body;
    const meta = CONNECTORS.find(c => c.id === connectorId);
    if (!meta) return res.status(404).json({ ok: false, error: 'Unknown connector' });
    if (!depIndex || depIndex < 0 || depIndex >= meta.dependencies.length) return res.status(400).json({ ok: false, error: 'Invalid dependency index' });
    const state = states[connectorId] || { missingDeps: [], installed: false };
    installDependency(meta, depIndex).then(result => {
      if (result.success) { state.missingDeps = meta.dependencies.map(d => d.check).filter(check => !result.remaining.includes(check)); state.installed = state.missingDeps.length === 0; }
      states[connectorId] = state;
      saveConnectorStates(states);
      res.json({ ok: true, connectorId, depIndex, success: result.success, remaining: result.remaining });
    }).catch(err => res.status(500).json({ ok: false, error: err.message }));
  });

  router.post('/set-config', (req: Request, res: Response) => {
    const { connectorId, key, value } = req.body;
    const meta = CONNECTORS.find(c => c.id === connectorId);
    if (!meta) return res.status(404).json({ ok: false, error: 'Unknown connector' });
    const configItem = meta.configItems.find(c => c.key === key);
    if (!configItem) return res.status(404).json({ ok: false, error: `Unknown config key: ${key}` });
    const connConfigDir = path.join(CONFIG_DIR, connectorId); try { fs.mkdirSync(connConfigDir, { recursive: true }); } catch {}
    const connConfigFile = path.join(connConfigDir, 'config.json');
    let config: Record<string, string> = {};
    if (fs.existsSync(connConfigFile)) config = JSON.parse(fs.readFileSync(connConfigFile, 'utf-8'));
    config[key] = value;
    fs.writeFileSync(connConfigFile, JSON.stringify(config, null, 2), 'utf-8');
    const state = states[connectorId] || { missingConfig: [] };
    state.missingConfig = (state.missingConfig || []).filter(k => k !== key);
    state.configured = state.missingConfig.length === 0;
    states[connectorId] = state;
    saveConnectorStates(states);
    res.json({ ok: true, connectorId, key, remaining: state.missingConfig || [] });
  });

  router.get('/:id/config', (req: Request, res: Response) => {
    const { id } = req.params;
    const connConfigFile = path.join(CONFIG_DIR, id, 'config.json');
    if (!fs.existsSync(connConfigFile)) return res.json({ ok: true, config: {}, message: 'No configuration yet' });
    try {
      const config = JSON.parse(fs.readFileSync(connConfigFile, 'utf-8'));
      const sensitiveKeys = ['appsecret', 'api_key', 'token', 'password', 'secret'];
      const sanitized: Record<string, any> = {};
      for (const [k, v] of Object.entries(config)) {
        const isSensitive = sensitiveKeys.some(s => k.toLowerCase().includes(s));
        if (isSensitive && typeof v === 'string' && v.length >= 8) sanitized[k] = v.substring(0, 4) + '***' + v.substring(v.length - 4);
        else sanitized[k] = v;
      }
      res.json({ ok: true, config: sanitized });
    } catch (e) { res.json({ ok: true, config: {}, error: 'Failed to read config' }); }
  });

  // ═══ AI 自动驱动端点: 获取待办事项 (安装/配置) ═══
  router.get('/ai/pending-tasks', (_req, res) => {
    const tasks: Array<{
      connectorId: string;
      connectorName: string;
      type: 'install' | 'config';
      items: Array<{ key: string; description: string; platform?: string }>;
    }> = [];

    for (const meta of CONNECTORS) {
      const state = states[meta.id];
      if (!state || !state.enabled) continue;

      // 待安装依赖
      if (!state.installed && meta.dependencies.length > 0) {
        const pendingDeps = meta.dependencies
          .filter((d, i) => state.missingDeps?.includes(d.check))
          .map((d, i) => ({
            key: `dep-${i}`,
            description: d.description,
            platform: d.platform,
            installCommands: getInstallCommandsForPlatform(d),
          }));
        if (pendingDeps.length > 0) {
          tasks.push({
            connectorId: meta.id,
            connectorName: meta.name,
            type: 'install',
            items: pendingDeps,
          });
        }
      }

      // 待配置项
      if (!state.configured && meta.configItems.length > 0) {
        const pendingConfig = meta.configItems
          .filter(c => c.required && state.missingConfig?.includes(c.key))
          .map(c => ({
            key: c.key,
            description: `${c.label}: ${c.hint}`,
            placeholder: c.placeholder,
            defaultValue: c.defaultValue,
          }));
        if (pendingConfig.length > 0) {
          tasks.push({
            connectorId: meta.id,
            connectorName: meta.name,
            type: 'config',
            items: pendingConfig,
          });
        }
      }
    }

    res.json({ ok: true, tasks, total: tasks.length });
  });

  // ═══ AI 自动驱动端点: 批量检查依赖状态 ═══
  router.post('/ai/check-deps', async (req: Request, res: Response) => {
    const { connectorId } = req.body;
    const meta = CONNECTORS.find(c => c.id === connectorId);
    if (!meta) return res.status(404).json({ ok: false, error: 'Unknown connector' });

    const results = await Promise.all(
      meta.dependencies.map(async (dep, index) => {
        const installed = await checkCommand(dep.check);
        return {
          index,
          check: dep.check,
          description: dep.description,
          installed,
          installCommands: getInstallCommandsForPlatform(dep),
        };
      })
    );

    // 更新状态
    const state = states[connectorId] || { missingDeps: [], installed: false };
    state.missingDeps = results.filter(r => !r.installed).map(r => r.check);
    state.installed = state.missingDeps.length === 0;
    states[connectorId] = state;
    saveConnectorStates(states);

    res.json({ ok: true, connectorId, results, allInstalled: state.installed });
  });

  // ═══ AI 自动驱动端点: 执行安装命令 ═══
  router.post('/ai/execute-install', async (req: Request, res: Response) => {
    const { connectorId, depIndex } = req.body;
    const meta = CONNECTORS.find(c => c.id === connectorId);
    if (!meta) return res.status(404).json({ ok: false, error: 'Unknown connector' });
    if (depIndex < 0 || depIndex >= meta.dependencies.length) {
      return res.status(400).json({ ok: false, error: 'Invalid dependency index' });
    }

    const dep = meta.dependencies[depIndex];
    const installCmds = getInstallCommandsForPlatform(dep);

    if (installCmds.length === 0) {
      return res.json({ ok: true, connectorId, depIndex, executed: false, reason: 'no_install_commands' });
    }

    const results: Array<{ command: string; success: boolean; output?: string; error?: string }> = [];
    for (const cmd of installCmds) {
      try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
        results.push({ command: cmd, success: true, output: stdout });
        // 成功一个就停止
        break;
      } catch (e: any) {
        results.push({ command: cmd, success: false, error: e.message, output: e.stdout });
      }
    }

    const anySuccess = results.some(r => r.success);
    if (anySuccess) {
      const state = states[connectorId] || { missingDeps: [], installed: false };
      state.missingDeps = (state.missingDeps || []).filter(d => d !== dep.check);
      state.installed = state.missingDeps.length === 0;
      states[connectorId] = state;
      saveConnectorStates(states);
    }

    res.json({
      ok: true,
      connectorId,
      depIndex,
      executed: true,
      success: anySuccess,
      results,
    });
  });

  return router;
}