import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  saveTargetState,
  loadTargetState,
  formatTargetStateBrief,
  slugifyTarget,
} from '../pentest/target-state.js';
import { TOOL_GROUPS, TASK_TYPE_TOOL_MAP } from '../tool-groups.js';
import { SECURITY_OPS_TOOLS } from '../security-playbook.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-state-test-'));
const wsA = path.join(tmp, 'wsA');
const wsB = path.join(tmp, 'wsB');
fs.mkdirSync(wsA, { recursive: true });
fs.mkdirSync(wsB, { recursive: true });
const prevHome = process.env.AGENTAI_HOME;
process.env.AGENTAI_HOME = path.join(tmp, 'global');

afterAll(() => {
  process.env.AGENTAI_HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('slugifyTarget 归一化', () => {
  it('去除 scheme/www/尾部斜杠', () => {
    expect(slugifyTarget('https://www.Example.com/')).toBe('example.com');
    expect(slugifyTarget('http://a.b.com:8080/x')).toBe('a.b.com_8080_x');
  });
  it('空/非法输入兜底', () => {
    expect(slugifyTarget('   ')).toBe('unknown');
  });
});

describe('save/load 合并去重', () => {
  it('save 新建 → load 读回全部字段', () => {
    const s = saveTargetState(
      wsA,
      'example.com',
      {
        discoveredSubdomains: ['api.example.com', 'www.example.com'],
        testedEndpoints: ['https://example.com/login POST'],
        attackSurface: ['/admin'],
      },
      'tester',
    );
    expect(s.discoveredSubdomains).toContain('api.example.com');
    const back = loadTargetState(wsA, 'example.com');
    expect(back).not.toBeNull();
    expect(back!.target).toBe('example.com');
    expect(back!.testedEndpoints).toEqual(['https://example.com/login POST']);
    expect(back!.updatedBy).toBe('tester');
    expect(back!.lastUpdated).toBeGreaterThan(0);
  });

  it('二次 save 合并去重, 不覆盖未传字段', () => {
    saveTargetState(wsA, 'example.com', { discoveredSubdomains: ['api.example.com'] });
    const s2 = saveTargetState(wsA, 'example.com', { attackSurface: ['/admin', '/admin'] });
    expect(s2.attackSurface).toEqual(['/admin']); // 去重
    expect(s2.discoveredSubdomains).toContain('api.example.com'); // 保留
    expect(s2.testedEndpoints).toContain('https://example.com/login POST'); // 保留
  });
});

describe('全局回退', () => {
  it('工作区无文件时回退读全局库', () => {
    const slug = slugifyTarget('fallback.com');
    const gf = path.join(process.env.AGENTAI_HOME!, 'pentest', 'target-state', slug + '.json');
    fs.mkdirSync(path.dirname(gf), { recursive: true });
    fs.writeFileSync(
      gf,
      JSON.stringify({
        target: 'fallback.com',
        discoveredSubdomains: ['x.fallback.com'],
        testedEndpoints: [],
        excludedItems: [],
        attackSurface: [],
        wafEncounters: [],
        findings: [],
        lastUpdated: 123,
      }, null, 2),
    );
    const back = loadTargetState(wsB, 'fallback.com'); // wsB 无文件
    expect(back).not.toBeNull();
    expect(back!.discoveredSubdomains).toContain('x.fallback.com');
  });
});

describe('formatTargetStateBrief', () => {
  it('空状态/null 返回空串', () => {
    expect(formatTargetStateBrief(null)).toBe('');
    expect(formatTargetStateBrief(loadTargetState(wsB, 'nope.com'))).toBe('');
  });
  it('有状态返回含关键标记', () => {
    const s = loadTargetState(wsA, 'example.com')!;
    const b = formatTargetStateBrief(s);
    expect(b).toContain('目标状态快照');
    expect(b).toContain('已发现子域');
    expect(b).toContain('不要重复已测');
  });
});

describe('工具接线', () => {
  for (const t of ['save_target_state', 'load_target_state']) {
    it(`${t} 在 security 工具集`, () => {
      expect(TOOL_GROUPS.security_ops).toContain(t);
      expect(TASK_TYPE_TOOL_MAP.security).toContain(t);
      expect(SECURITY_OPS_TOOLS.has(t)).toBe(true);
    });
  }
});
