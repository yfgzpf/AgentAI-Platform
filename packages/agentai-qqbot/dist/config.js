/**
 * QQ Bot 配置加载
 * 优先级: 环境变量 > 配置文件 > 默认值
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULTS = {
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
// interface QQConfig (类型) 与 const QQConfig (值) 同名是 TS 合法声明合并, eslint core 规则误报
// eslint-disable-next-line no-redeclare
export const QQConfig = {
    load() {
        // 1. 默认值
        const config = JSON.parse(JSON.stringify(DEFAULTS));
        // 2. 配置文件 (如果有)
        const configFile = process.env.AGENTAI_QQ_CONFIG || path.resolve(__dirname, '../config.json');
        if (fs.existsSync(configFile)) {
            const file = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            Object.assign(config, file);
            console.log(`[QQConfig] 加载配置文件: ${configFile}`);
        }
        // 3. 环境变量 (覆盖)
        if (process.env.AGENTAI_GATEWAY_URL)
            config.gatewayUrl = process.env.AGENTAI_GATEWAY_URL;
        if (process.env.AGENTAI_QQ_ADMIN)
            config.adminQQ = process.env.AGENTAI_QQ_ADMIN.split(',').map(Number);
        if (process.env.AGENTAI_QQ_GROUPS)
            config.allowedGroups = process.env.AGENTAI_QQ_GROUPS.split(',').map(Number);
        if (process.env.AGENTAI_QQ_TRIGGER)
            config.triggerPrefix = process.env.AGENTAI_QQ_TRIGGER;
        if (process.env.AGENTAI_QQ_AUTOSTART)
            config.goCqHttp.autoStart = process.env.AGENTAI_QQ_AUTOSTART === '1';
        if (process.env.AGENTAI_QQ_ACCOUNT)
            config.goCqHttp.qq = parseInt(process.env.AGENTAI_QQ_ACCOUNT, 10);
        return config;
    },
};
//# sourceMappingURL=config.js.map