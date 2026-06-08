/**
 * QQ Bot 配置加载
 * 优先级: 环境变量 > 配置文件 > 默认值
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface QQConfig {
  /** Gateway HTTP 地址, 用于调 /v1/qq/message */
  gatewayUrl: string;
  /** 触发前缀, 例如 "@bot " (留空 = 群内所有消息) */
  triggerPrefix: string;
  /** 允许的群号列表, 留空 = 所有群 */
  allowedGroups: number[];
  /** 管理员 QQ 号 (可执行管理命令) */
  adminQQ: number[];
  /** 离线时是否继续运行 */
  allowOffline: boolean;
  /** go-cqhttp 子进程配置 */
  goCqHttp: {
    autoStart: boolean;
    /** 子进程可执行路径 */
    binaryPath: string;
    /** 配置文件路径 */
    configPath: string;
    /** 反向 WebSocket 地址 (本包监听 go-cqhttp 连入) */
    reverseWsUrl: string;
    /** go-cqhttp HTTP API 地址 (本包调它发消息) */
    httpApiUrl: string;
    /** QQ 账号 */
    qq: number;
    /** QQ 密码 (不推荐明文, 建议扫码) */
    password?: string;
  };
}

const DEFAULTS: QQConfig = {
  gatewayUrl: 'http://127.0.0.1:18789',
  triggerPrefix: '',
  allowedGroups: [],
  adminQQ: [],
  allowOffline: false,
  goCqHttp: {
    autoStart: false,
    binaryPath: path.resolve(__dirname, '../bin/go-cqhttp'),
    configPath: path.resolve(__dirname, '../bin/config.yml'),
    reverseWsUrl: 'ws://127.0.0.1:5700',
    httpApiUrl: 'http://127.0.0.1:5700',
    qq: 0,
  },
};

export const QQConfig = {
  load(): QQConfig {
    // 1. 默认值
    const config: QQConfig = JSON.parse(JSON.stringify(DEFAULTS));

    // 2. 配置文件 (如果有)
    const configFile = process.env.AGENTAI_QQ_CONFIG || path.resolve(__dirname, '../config.json');
    if (fs.existsSync(configFile)) {
      const file = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      Object.assign(config, file);
      console.log(`[QQConfig] 加载配置文件: ${configFile}`);
    }

    // 3. 环境变量 (覆盖)
    if (process.env.AGENTAI_GATEWAY_URL) config.gatewayUrl = process.env.AGENTAI_GATEWAY_URL;
    if (process.env.AGENTAI_QQ_ADMIN) config.adminQQ = process.env.AGENTAI_QQ_ADMIN.split(',').map(Number);
    if (process.env.AGENTAI_QQ_GROUPS) config.allowedGroups = process.env.AGENTAI_QQ_GROUPS.split(',').map(Number);
    if (process.env.AGENTAI_QQ_TRIGGER) config.triggerPrefix = process.env.AGENTAI_QQ_TRIGGER;
    if (process.env.AGENTAI_QQ_AUTOSTART) config.goCqHttp.autoStart = process.env.AGENTAI_QQ_AUTOSTART === '1';
    if (process.env.AGENTAI_QQ_ACCOUNT) config.goCqHttp.qq = parseInt(process.env.AGENTAI_QQ_ACCOUNT, 10);

    return config;
  },
};
