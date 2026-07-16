/**
 * e2e-desktop-extended.ts
 * ----------------------------------------------------
 * 验证扩展桌面自动化能力:
 *  - system_info     (系统状态)
 *  - launch_app      (启动应用 - 白名单 + URL)
 *  - wait_for_window (等待窗口)
 *  - set_volume / toggle_mute (音量)
 *  - lock_screen     (锁屏 - 不会真的锁, 只测 API)
 *
 * 注: 锁屏真会锁屏! 谨慎运行 (或传入 --no-lock 跳过)
 */
import {
  getSystemInfo, launchApp, waitForWindow, setVolume, toggleMute, lockScreen,
  desktopAutomationHealth,
} from './desktop-automation.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\n========== Desktop Automation Extended E2E ==========\n');

  const health = await desktopAutomationHealth();
  if (!health.powershell) {
    console.log('⛔ Skip: not Windows / PowerShell unavailable');
    return;
  }
  check('health ok', health.ok, `pwsh=${health.version}`);

  // 1. system_info (CIM 查询较慢, ~5s, 单独超时保护)
  console.log('\n[1] system_info');
  const info = await Promise.race([
    getSystemInfo(),
    new Promise<{ ok: false; error: string }>((r) => setTimeout(() => r({ ok: false, error: 'system_info timeout (>12s)' }), 12000)),
  ]);
  check('system_info ok', info.ok && !!(info as any).data, (info as any).error);
  if ((info as any).data) {
    const d = (info as any).data;
    check('os 非空', !!d.os, `os=${d.os}`);
    check('cpuPercent 是数字', typeof d.cpuPercent === 'number', `cpu=${d.cpuPercent}%`);
    check('memory.totalGB > 0', d.memory.totalGB > 0, `total=${d.memory.totalGB}GB`);
    check('内存百分比合理', d.memory.percent >= 0 && d.memory.percent <= 100, `mem=${d.memory.percent}%`);
    check('disks 至少 1 个', Array.isArray(d.disks) && d.disks.length > 0, `count=${d.disks?.length}`);
    check('uptimeHours > 0', d.uptimeHours > 0, `uptime=${d.uptimeHours}h`);
  }

  // 2. launch_app (白名单 / 拒绝 / 路径存在 / URL)
  console.log('\n[2] launch_app');
  // 白名单: notepad
  const r1 = await launchApp({ target: 'notepad' });
  check('launch_app(notepad) 成功', r1.ok, r1.error);
  // 用 list_processes 验证 notepad 真的启动了 (跳过 kill, 避免连环超时)
  if (r1.ok) {
    const { listProcesses } = await import('./desktop-automation.js');
    const procs = await listProcesses({ nameFilter: 'notepad', onlyWithWindow: false, limit: 10 });
    check('notepad 进程存在', procs.length > 0, `count=${procs.length}`);
    if (procs.length > 0) {
      check('notepad 有 pid', procs[0].pid > 0, `pid=${procs[0].pid}`);
    }
  }
  // wait_for_window: 测 API 行为即可 (不依赖特定窗口)
  const w1 = await waitForWindow({ titleContains: '__definitely_not_a_real_window_xyz_12345__', timeoutMs: 3000, pollMs: 1000 });
  check('wait_for_window(不存在) 返回 ok=false', !w1.ok, w1.error?.slice(0, 50));
  // 拒绝非白名单命令
  const r2 = await launchApp({ target: 'powershell_evil' });
  check('launch_app(非白名单) 被拒', !r2.ok, r2.error);
  // 拒绝不存在的路径
  const r3 = await launchApp({ target: 'C:\\nonexistent\\fake.exe' });
  check('launch_app(不存在路径) 被拒', !r3.ok, r3.error);
  // 拒绝 file:// 协议
  const r4 = await launchApp({ target: 'file:///c:/windows/system32/cmd.exe' });
  check('launch_app(file://) 被拒', !r4.ok, r4.error);
  // 接受 http URL (打开浏览器, 会真打开, 用户注意)
  // const r5 = await launchApp({ target: 'https://example.com' });
  // check('launch_app(https://) ok', r5.ok, r5.error);

  // 3. wait_for_window 失败路径 (嵌套超时, 跳过快速测试)
  console.log('\n[3] wait_for_window 失败路径 (跳过: 内部 PowerShell 5s 超时大于外部 1.5s)');
  console.log('⏭️  跳过 (单元测试覆盖)');

  // 4. 音量控制
  console.log('\n[4] 音量控制');
  const v1 = await setVolume(50);
  check('set_volume(50) ok', v1.ok, v1.error);
  const v2 = await setVolume(150);
  check('set_volume(150) 被拒', !v2.ok, v2.error);
  const v3 = await setVolume(-1);
  check('set_volume(-1) 被拒', !v3.ok, v3.error);
  const m1 = await toggleMute();
  check('toggle_mute ok', m1.ok, m1.error);

  // 5. lock_screen (默认跳过, 真会锁屏)
  console.log('\n[5] lock_screen (默认跳过)');
  const skipLock = process.argv.includes('--no-lock');
  if (skipLock) {
    const l = await lockScreen();
    check('lock_screen ok', l.ok, l.error);
  } else {
    console.log('⏭️  跳过 lock_screen (传 --no-lock 测试)');
  }

  // 总结
  console.log('\n========== 结果 ==========');
  console.log(`通过: ${passed} / 失败: ${failed} / 总计: ${passed + failed}`);
  if (failed === 0) console.log('\n🎉 全部通过!');
  else { console.log('\n⚠️ 有失败项'); process.exit(1); }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('E2E failed:', e);
  process.exit(1);
});
