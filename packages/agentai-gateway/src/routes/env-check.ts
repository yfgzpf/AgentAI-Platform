/**
 * 环境体检路由 (2026-10-17)
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要有这个:
 *   富哥问"别人装上 PulseFlow 后, 缺什么会主动装什么?" —— 探索结论是:
 *   auto-install 白名单只覆盖 gateway-deps / playwright;
 *   node/python/git/webview2 **只检测不给装**; Kali 工具链(nmap/nuclei/sqlmap)完全不管。
 *   于是"缺什么"对用户是黑盒 —— 只能等 AI 自己摸, 体验极差。
 *
 * 本模块提供 **只读体检**:
 *   GET /v1/system/env-check → 逐项返回 { installed, version, installHint, autoInstallable }
 *   全程只做检测 (which/--version/registry 查询), **绝不执行任何安装动作**。
 *   安装交给: ① AI 自己用 bash 装 (用户已确认"kali 可以让 AI 自己装") ② 用户手动点链接
 */

import { Router } from 'express';
import { execFile } from 'child_process';

const router = Router();

/** 执行一个短命令并返回 { ok, stdout }；超时 5s，绝不 throw */
function probe(cmd: string, args: string[], timeout = 5000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
        const out = String(stdout || '') + String(stderr || '');
        resolve({ ok: !err, out: out.trim() });
      });
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

interface CheckItem {
  id: string;
  name: string;
  /** 检测方式：which/--version/registry/powershell */
  kind: 'which' | 'version' | 'registry' | 'powershell';
  cmd?: string;
  args?: string[];
  /** auto-install 白名单里的 dep 名（若支持自动安装） */
  dep?: string;
  /** 人工安装指引（不自动装时给用户） */
  installHint: string;
  /** 该项是否属于渗透工具链（UI 分组用） */
  group: 'core' | 'pentest' | 'browser';
}

/**
 * 检测清单。
 * ⚠️ 原则: 每项都必须能在 5 秒内返回, 任何一项卡住都不能拖垮整个体检。
 * ⚠️ WSL/Kali 的探测**故意用 wsl.exe**, 它在很多环境被策略拦截/未安装 →
 *    这正是要暴露给用户的信息, 不能因为探测失败就整个端点挂掉。
 */
const CHECKS: CheckItem[] = [
  // ── 核心运行时 ──
  { id: 'node', name: 'Node.js 22+', kind: 'version', cmd: 'node', args: ['--version'], dep: 'node',
    installHint: 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi', group: 'core' },
  { id: 'python', name: 'Python 3.x', kind: 'version', cmd: 'python', args: ['--version'], dep: 'python',
    installHint: 'https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe', group: 'core' },
  { id: 'git', name: 'Git', kind: 'version', cmd: 'git', args: ['--version'], dep: 'git',
    installHint: 'https://github.com/git-for-windows/git/releases/latest', group: 'core' },

  // ── 浏览器自动化 ──
  { id: 'playwright', name: 'Playwright Chromium', kind: 'powershell',
    cmd: 'powershell', args: ['-NoProfile', '-Command',
      "Test-Path \"$env:LOCALAPPDATA\\ms-playwright\""], dep: 'playwright',
    installHint: 'npx playwright install chromium（首次运行自动安装，约 3GB）', group: 'browser' },

  // ── 渗透工具链（Kali/WSL）──
  { id: 'wsl', name: 'WSL (Kali 运行环境)', kind: 'version', cmd: 'wsl', args: ['--status'],
    installHint: 'wsl --install -d kali-linux（需管理员权限，重启后生效）', group: 'pentest' },
  { id: 'nmap', name: 'nmap', kind: 'version', cmd: 'wsl', args: ['-e', 'sh', '-lc', 'nmap --version | head -1'],
    installHint: '在 Kali 内: sudo apt update && sudo apt install -y nmap', group: 'pentest' },
  { id: 'nuclei', name: 'nuclei', kind: 'version', cmd: 'wsl', args: ['-e', 'sh', '-lc', 'nuclei -version 2>&1 | head -1'],
    installHint: '在 Kali 内: go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest', group: 'pentest' },
  { id: 'sqlmap', name: 'sqlmap', kind: 'version', cmd: 'wsl', args: ['-e', 'sh', '-lc', 'sqlmap --version 2>&1 | head -1'],
    installHint: '在 Kali 内: sudo apt install -y sqlmap', group: 'pentest' },
];

/** auto-install 真能自动装的（其余只给下载链接） */
const AUTO_INSTALLABLE = new Set(['gateway-deps', 'playwright']);

router.get('/env-check', async (_req, res) => {
  const results = await Promise.all(
    CHECKS.map(async (c): Promise<Record<string, any>> => {
      if (!c.cmd) return { ...base(c), installed: false, version: undefined };
      const r = await probe(c.cmd, c.args || []);
      // WSL 未安装时 stderr 会带指导文案, 已装但命令缺时也有信息 —— 都保留给用户看
      const version = r.ok ? r.out.split(/\r?\n/)[0]?.slice(0, 80) : undefined;
      return {
        ...base(c),
        installed: r.ok,
        // 探测失败时把 stderr 尾巴带上(常有"未安装, 请运行 xxx"提示), 便于定位
        detail: r.ok ? undefined : r.out.slice(0, 200) || undefined,
        version,
      };
    }),
  );

  const missing = results.filter((r) => !r.installed);
  res.json({
    ok: true,
    checkedAt: Date.now(),
    isDesktop: process.env.AGENTAI_DESKTOP === '1',
    summary: {
      total: results.length,
      installed: results.length - missing.length,
      missing: missing.length,
      // ⚠️ 关键: 缺渗透工具**不阻塞**正常使用, 只是能力降级
      pentestReady: results.filter((r) => r.group === 'pentest').every((r) => r.installed),
    },
    items: results,
  });

  function base(c: CheckItem) {
    return {
      id: c.id,
      name: c.name,
      group: c.group,
      dep: c.dep,
      installHint: c.installHint,
      autoInstallable: !!(c.dep && AUTO_INSTALLABLE.has(c.dep)),
    };
  }
});

/**
 * POST /v1/system/env-check/install-hint
 * 只**返回**安装命令, 不执行。真正的动作由 AI (用户授权) 或用户自己执行。
 * 理由: 自动装 Kali 需要管理员权限 + 重启, 静默执行风险太高。
 */
router.post('/env-check/install-hint', (req, res) => {
  const { id } = req.body || {};
  const item = CHECKS.find((c) => c.id === id);
  if (!item) return res.status(404).json({ ok: false, error: `未知检测项: ${id}` });
  return res.json({
    ok: true,
    id: item.id,
    name: item.name,
    installHint: item.installHint,
    autoInstallable: !!(item.dep && AUTO_INSTALLABLE.has(item.dep)),
    note: item.dep && AUTO_INSTALLABLE.has(item.dep)
      ? '可由系统自动安装 (POST /v1/system/auto-install)。'
      : '需人工执行安装命令 —— 涉及管理员权限, 系统不会静默执行。',
  });
});

export default router;
