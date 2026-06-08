/**
 * QQ Bot 单元测试
 * - Config 加载
 * - GatewayProxy 调用 mock
 * - 触发前缀过滤
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { QQConfig } from '../src/config.js';
import { GatewayProxy } from '../src/gateway-proxy.js';

describe('QQConfig', () => {
  it('应加载默认配置', () => {
    const config = QQConfig.load();
    expect(config.gatewayUrl).toMatch(/^http/);
    expect(config.goCqHttp).toBeDefined();
    expect(config.goCqHttp.reverseWsUrl).toMatch(/^ws/);
  });

  it('环境变量应覆盖', () => {
    process.env.AGENTAI_GATEWAY_URL = 'http://test:1234';
    process.env.AGENTAI_QQ_AUTOSTART = '1';
    const config = QQConfig.load();
    expect(config.gatewayUrl).toBe('http://test:1234');
    expect(config.goCqHttp.autoStart).toBe(true);
    delete process.env.AGENTAI_GATEWAY_URL;
    delete process.env.AGENTAI_QQ_AUTOSTART;
  });
});

describe('GatewayProxy', () => {
  it('health 检查应返回 false (离线)', async () => {
    const p = new GatewayProxy('http://127.0.0.1:1'); // 不存在端口
    const ok = await p.health();
    expect(ok).toBe(false);
  });
});
