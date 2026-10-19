import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EXTRA_HANDLERS, EXTRA_TOOLS } from '../tools.js';
import { TOOL_GROUPS, TASK_TYPE_TOOL_MAP } from '../tool-groups.js';
import { SECURITY_PLAYBOOK, SECURITY_OPS_TOOLS } from '../security-playbook.js';
import {
  startOobServer, stopOobServer, createOobId, checkOob, getPort, getCallbackBase,
} from '../oob-listener.js';

beforeAll(async () => {
  await startOobServer(0); // 随机端口, 仅测试用
});
afterAll(() => {
  stopOobServer();
});

describe('oob: 结构与接线 (2026-10-19: 填补盲测盲区)', () => {
  it('两个工具都已声明且可从 EXTRA_HANDLERS 取到', () => {
    expect(EXTRA_TOOLS.some((t: any) => t.name === 'oob_register')).toBe(true);
    expect(EXTRA_TOOLS.some((t: any) => t.name === 'oob_check')).toBe(true);
    expect(typeof EXTRA_HANDLERS.oob_register).toBe('function');
    expect(typeof EXTRA_HANDLERS.oob_check).toBe('function');
  });

  it('声明写清盲测用途与公网可达性说明', () => {
    const decl = EXTRA_TOOLS.find((t: any) => t.name === 'oob_register') as any;
    expect(decl.description).toContain('盲测');
    expect(decl.description).toContain('OOB_PUBLIC_URL');
    expect(decl.description).toContain('share_port');
  });

  it('三处工具集都接进 (security_ops / TASK_TYPE_TOOL_MAP.security / SECURITY_OPS_TOOLS)', () => {
    for (const t of ['oob_register', 'oob_check']) {
      expect(TOOL_GROUPS.security_ops).toContain(t);
      expect(TASK_TYPE_TOOL_MAP.security).toContain(t);
      expect(SECURITY_OPS_TOOLS.has(t)).toBe(true);
    }
  });

  it('Playbook 工具铁律点名 oob_register + oob_check', () => {
    expect(SECURITY_PLAYBOOK).toContain('oob_register');
    expect(SECURITY_PLAYBOOK).toContain('oob_check');
  });
});

describe('oob-listener: 真实 HTTP 回连 (盲测确认)', () => {
  it('目标回连 /oob/:id → 记录来源 IP / method / body', async () => {
    const { id } = createOobId('airbnb-blind-xss');
    const port = getPort();
    const res = await fetch(`http://127.0.0.1:${port}/oob/${id}`, {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '9.9.9.9' },
      body: 'pwned-payload',
    });
    expect(res.status).toBe(200);
    const r = checkOob(id);
    expect(r.found).toBe(true);
    expect(r.record!.hits.length).toBe(1);
    expect(r.record!.hits[0].method).toBe('POST');
    expect(r.record!.hits[0].ip).toContain('9.9.9.9');
    expect(r.record!.hits[0].ua).toContain('Mozilla');
    expect(r.record!.hits[0].body).toContain('pwned-payload');
  });

  it('未知 oob_id → 404 且不记录 (防污染/探测)', async () => {
    const port = getPort();
    const res = await fetch(`http://127.0.0.1:${port}/oob/deadbeefdeadbeefdeadbeef`, { method: 'GET' });
    expect(res.status).toBe(404);
    expect(checkOob('deadbeefdeadbeefdeadbeef').found).toBe(false);
  });

  it('callbackUrl 指向实际监听端口', () => {
    const { id, callbackUrl } = createOobId('x');
    expect(callbackUrl).toContain(`:${getPort()}/oob/${id}`);
    expect(getCallbackBase()).toContain(`:${getPort()}`);
  });
});

describe('oob 工具层: register / check', () => {
  it('oob_register 返回 id + callbackUrl', async () => {
    const r: any = await EXTRA_HANDLERS.oob_register({ label: 't' });
    expect(r.success).toBe(true);
    expect(r.data.id).toBeTruthy();
    expect(r.data.callbackUrl).toContain('/oob/');
  });

  it('oob_check 未命中 → 友好提示而非报错', async () => {
    const r: any = await EXTRA_HANDLERS.oob_check({ id: 'nonexistent0123456789ab' });
    expect(r.success).toBe(true);
    expect(r.data.found).toBe(false);
    expect(String(r.output)).toContain('尚未收到回连');
  });

  it('oob_check 命中 → 确认回连 (端到端: register → 回连 → check)', async () => {
    const reg: any = await EXTRA_HANDLERS.oob_register({ label: 'e2e' });
    const id = reg.data.id;
    const port = getPort();
    const res = await fetch(`http://127.0.0.1:${port}/oob/${id}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const chk: any = await EXTRA_HANDLERS.oob_check({ id });
    expect(chk.success).toBe(true);
    expect(chk.data.found).toBe(true);
    expect(chk.data.hits.length).toBe(1);
    expect(String(chk.output)).toContain('确认回连');
  });
});
