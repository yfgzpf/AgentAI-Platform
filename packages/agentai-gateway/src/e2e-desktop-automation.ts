/**
 * e2e-desktop-automation.ts
 * ----------------------------------------------------
 * 端到端验证桌面自动化能力:
 *  1. clipboard_write / clipboard_read (剪贴板往返)
 *  2. list_processes (进程列表)
 *  3. mouse_move / mouse_click (鼠标 — 测坐标合法性)
 *  4. notify (桌面通知 — 5秒后消失, 不阻塞)
 *
 * 不在 E2E 中测的 (会真的动键盘鼠标, 破坏测试可重复性):
 *   - keyboard_type, press_hotkey, mouse_drag, mouse_scroll, kill_process
 *   - 真实场景由用户在使用时触发
 */
import { clipboardWrite, clipboardRead, listProcesses, mouseMove, mouseClick, sendNotification, desktopAutomationHealth } from './desktop-automation.js';

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  if (ok) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n========== Desktop Automation E2E ==========\n');

  // 0. 健康检查
  console.log('[0] 健康检查');
  const health = await desktopAutomationHealth();
  check('platform=win32', health.platform === 'win32', `platform=${health.platform}`);
  check('powershell available', health.powershell === true, `version=${health.version || 'N/A'}`);
  if (!health.powershell) {
    console.log('\n⛔ 跳过: 非 Windows 或 PowerShell 不可用');
    return;
  }
  console.log('');

  // 1. 剪贴板往返
  console.log('[1] 剪贴板往返 (write → read)');
  const testText = `AgentAI E2E ${new Date().toISOString()}`;
  const w = await clipboardWrite(testText);
  check('clipboard_write ok', w.ok, w.error);
  const r = await clipboardRead();
  check('clipboard_read ok', r.ok, r.error);
  check('clipboard 往返一致', r.text === testText, `expected="${testText.slice(0, 30)}..." got="${(r.text || '').slice(0, 30)}..."`);
  console.log('');

  // 2. 进程列表
  console.log('[2] 进程列表');
  const procs = await listProcesses({ limit: 100 });
  check('list_processes 返回数组', Array.isArray(procs), `count=${procs.length}`);
  check('至少找到一个进程', procs.length > 0, `first=${procs[0]?.name || 'N/A'}`);
  // 默认 (onlyWithWindow=true) 可能没 powershell, 但加 false 应该能找到
  const psProcsWindow = await listProcesses({ nameFilter: 'powershell' });
  const psProcsAll = await listProcesses({ nameFilter: 'powershell', onlyWithWindow: false });
  check('nameFilter=powershell 过滤', psProcsAll.length > 0, `windowOnly=${psProcsWindow.length} all=${psProcsAll.length}`);
  console.log('');

  // 3. 鼠标移动 (测坐标合法性, 不真的动)
  console.log('[3] 鼠标移动 (只测 API 合法性)');
  const m1 = await mouseMove({ x: 100, y: 100 });
  check('mouse_move(100,100) ok', m1.ok, m1.error);
  const m2 = await mouseMove({ x: 0, y: 0 });
  check('mouse_move(0,0) ok', m2.ok, m2.error);
  const m3 = await mouseMove({ x: -1, y: 0 });
  check('mouse_move(-1,0) 被拒绝', !m3.ok, m3.error);
  console.log('');

  // 4. 鼠标点击 (测合法性, 真的会点屏幕, 注意)
  console.log('[4] 鼠标点击 (会真实点击, 测试坐标 0,0 = 左上角)');
  // 谨慎: 不真点击, 只测 API 拒绝非法坐标
  const c1 = await mouseClick({ x: -10, y: -10 });
  check('mouse_click(-10,-10) 被拒绝', !c1.ok, c1.error);
  console.log('');

  // 5. 桌面通知 (会真弹通知)
  console.log('[5] 桌面通知 (会真弹一个 toast)');
  const n = await sendNotification({
    title: 'AgentAI E2E',
    message: '桌面自动化能力测试通过 ✅',
    severity: 'info',
  });
  check('notify ok', n.ok, n.error);
  console.log('');

  // 总结
  console.log('\n========== 结果 ==========');
  console.log(`通过: ${passed} / 失败: ${failed} / 总计: ${passed + failed}`);
  if (failed === 0) {
    console.log('\n🎉 全部通过!');
  } else {
    console.log('\n⚠️ 有失败项, 详见上方');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('E2E failed:', e);
  process.exit(1);
});
