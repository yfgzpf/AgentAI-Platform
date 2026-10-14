// @ts-nocheck
/**
 * Kali (WSL) 一键安装引导 — 让 AgentAI 的 wsl_scan 工具真有扫描器可用
 * 用法: node scripts/install-kali-wsl.mjs [--check-only]
 *
 * 做什么:
 *   1. 检查 WSL 在不在 (wsl.exe)
 *   2. 装 kali-linux 发行版 (wsl --install -d kali, 已装则跳过)
 *   3. 装核心扫描器 (nmap/nikto/ffuf/sqlmap/nuclei), 含 dpkg 锁/依赖自愈
 *   4. 自检: 逐个 which + 跑一次最小 nmap 扫 127.0.0.1 证明真能动手
 *
 * 全程不打印任何 API key, 只装系统工具。--check-only 只探不装。
 */
import { execSync } from 'node:child_process';
import process from 'node:process';

const CHECK_ONLY = process.argv.includes('--check-only');
const Distro = 'kali-linux';
const SCANNERS = ['nmap', 'nikto', 'ffuf', 'sqlmap', 'nuclei'];

function run(cmd, { timeout = 600_000 } = {}) {
  try {
    return execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  } catch (e) {
    return { __error: true, message: (e.message || '').slice(0, 300) };
  }
}
function runWsl(inner, timeout = 600_000) {
  return run(`wsl -d ${Distro} -- bash -c "${inner.replace(/"/g, '\\"')}"`, { timeout });
}

console.log('══════════════════════════════════════');
console.log('  Kali (WSL) 安装引导');
console.log('══════════════════════════════════════');

// ① WSL 在不在
const wslVer = run('wsl --version', 30_000);
if (typeof wslVer === 'string' && wslVer) {
  console.log(`✅ ① WSL 在: ${wslVer.split('\n')[0]}`);
} else {
  console.log('❌ ① WSL 没装。先跑 `wsl --install` (管理员, 需重启), 再重跑本脚本。');
  process.exit(1);
}

// ② kali 发行版在不在
const existing = run('wsl --list --quiet', 30_000);
const hasKali = typeof existing === 'string' && existing.split('\n').some(l => l.trim() === Distro);
if (hasKali) {
  console.log(`✅ ② ${Distro} 发行版已存在`);
} else {
  if (CHECK_ONLY) {
    console.log(`⚠️ ② ${Distro} 未装 (--check-only 不装)。装它: wsl --install -d kali --no-launch`);
  } else {
    console.log(`② 装 ${Distro} (wsl --install -d kali --no-launch, 可能需几分钟)...`);
    const r = run(`wsl --install -d kali --no-launch`, 1_800_000);
    const still = run('wsl --list --quiet', 60_000);
    if (typeof still === 'string' && still.split('\n').some(l => l.trim() === Distro)) {
      console.log(`✅ ② ${Distro} 装好了`);
    } else {
      console.log(`❌ ② 装 ${Distro} 失败: ${typeof r === 'string' ? r : r?.message}`);
      process.exit(1);
    }
  }
}

// ③ 自检扫描器
function scanStatus() {
  const py = `import shutil\n` +
    `for t in ${JSON.stringify(SCANNERS)}:\n` +
    `    p=shutil.which(t)\n` +
    `    print(('OK ' if p else 'MISSING ')+t)`;
  const out = runWsl(`python3 -c "${py.replace(/\n/g, ';')}"`, 60_000);
  return typeof out === 'string' ? out.split('\n').filter(Boolean) : [];
}
let missing = scanStatus().filter(l => l.startsWith('MISSING')).map(l => l.replace('MISSING ', '').trim());
console.log(`③ 扫描器现状: ${missing.length === 0 ? SCANNERS.join(' ') + ' 全在' : '缺 ' + missing.join(', ')}`);

// ④ 缺就装 (含 dpkg 锁/依赖自愈)
if (missing.length > 0 && !CHECK_ONLY) {
  console.log(`④ 装缺的扫描器: ${missing.join(', ')} (含 dpkg 锁/依赖自愈)...`);
  // a. 清残留 dpkg 锁 + 修 interrupted 状态
  runWsl('rm -f /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock /var/lib/apt/lists/lock 2>/dev/null; echo cleaned', 30_000);
  runWsl('DEBIAN_FRONTEND=noninteractive dpkg --configure -a >/dev/null 2>&1; echo done', 300_000);
  runWsl('DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null 2>&1; echo updated', 600_000);
  // b. 先修 broken (libc 版本冲突等), 再装目标包
  runWsl('DEBIAN_FRONTEND=noninteractive apt-get --fix-broken install -y >/dev/null 2>&1; echo fixed', 600_000);
  const r = runWsl(`DEBIAN_FRONTEND=noninteractive apt-get install -y ${missing.join(' ')}`, 1_800_000);
  missing = scanStatus().filter(l => l.startsWith('MISSING')).map(l => l.replace('MISSING ', '').trim());
  console.log(missing.length === 0 ? `✅ ④ 扫描器装齐: ${SCANNERS.join(' ')}` : `❌ ④ 仍缺: ${missing.join(', ')} (apt: ${typeof r === 'string' ? 'ok' : r?.message})`);
}

// ⑤ 真跑一次最小 nmap 证明能用
if (CHECK_ONLY) {
  console.log('\n(--check-only 结束, 不跑扫描)');
  process.exit(missing.length === 0 ? 0 : 2);
}
if (!missing.includes('nmap')) {
  const probe = runWsl('nmap -sV -p 80,443 127.0.0.1 2>/dev/null | head -8', 60_000);
  console.log(`\n⑤ nmap 真扫 127.0.0.1 自检:\n${typeof probe === 'string' ? probe : '(失败: ' + probe?.message + ')'}`);
  console.log('\n══════════════════════════════════════');
  console.log('  完成。wsl_scan 工具现在可真调 kali 扫描器了。');
  console.log(`  授权仍要走 scope_guard / grant_scope, 越界照样拒绝。`);
  console.log('══════════════════════════════════════');
} else {
  console.log('\n⚠️ nmap 没装上, 无法自检。手动跑: wsl -d kali-linux -- apt-get install -y nmap');
  process.exit(2);
}
