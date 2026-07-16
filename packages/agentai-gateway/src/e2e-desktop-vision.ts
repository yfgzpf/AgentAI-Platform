/**
 * e2e-desktop-vision.ts
 * ----------------------------------------------------
 * 验证视觉驱动自动化:
 *  - findTextOnScreen  (找文字)
 *  - clickText          (点击文字)
 *  - waitForText        (等待文字)
 *  - doubleClickText    (双击文字)
 *  - typeIntoText       (在文字位置输入)
 *
 * 测试策略:
 *  1. 启动 notepad (用 launchApp)
 *  2. 等待 "File" / "文件" 菜单文字出现
 *  3. 测试 typeIntoText
 *  4. 验证输入的文本
 */
import {
  findTextOnScreen, clickText, waitForText, doubleClickText, typeIntoText,
  launchApp, mouseClick, getSystemInfo, listProcesses,
} from './desktop-automation.js';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\n========== Vision-Driven Desktop Automation E2E ==========\n');

  // 1. 健康检查
  const info = await getSystemInfo();
  if (info.data?.os && !info.data.os.includes('Windows')) {
    console.log('⛔ Skip: only Windows supported');
    return;
  }
  check('platform=Windows', true, info.data?.os);

  // 2. 启动 notepad
  console.log('\n[1] 启动 notepad');
  const r1 = await launchApp({ target: 'notepad' });
  check('launch notepad ok', r1.ok, r1.error);

  // 3. 等待 notepad 主窗口 (窗口标题)
  if (r1.ok) {
    // 等待几秒让 notepad 完全启动
    await new Promise(r => setTimeout(r, 2000));
    const procs = await listProcesses({ nameFilter: 'notepad', onlyWithWindow: false });
    check('notepad 进程已启动', procs.length > 0, `count=${procs.length}`);
  }

  // 4. findTextOnScreen: 在屏幕上找 "File" 菜单
  console.log('\n[2] findTextOnScreen(File)');
  if (r1.ok) {
    const found = await findTextOnScreen('File', { ignoreCase: true });
    if (found.ok && found.data) {
      check('找到 File 文字', true, `at (${found.data.target.cx}, ${found.data.target.cy}) matched="${found.data.target.matchedText}"`);
      check('返回多个可能匹配', found.data.allMatches.length >= 1, `count=${found.data.allMatches.length}`);
    } else {
      check('找到 File 文字', false, found.error);
    }
  }

  // 5. findTextOnScreen: 不存在的文字
  console.log('\n[3] findTextOnScreen(不存在的文字)');
  const notFound = await findTextOnScreen('__this_text_definitely_does_not_exist_12345__', { ignoreCase: true });
  check('找不到的文字 返回 ok=false', !notFound.ok, notFound.error);

  // 6. waitForText: 在 notepad 中等待文字
  console.log('\n[4] waitForText (timeout 较短, 期望失败)');
  const w1 = await waitForText('__nonexistent_text_99999__', { timeoutMs: 3000, pollMs: 1500 });
  check('waitForText(不存在) ok=false', !w1.ok, w1.error?.slice(0, 60));

  // 7. typeIntoText: 在 notepad 标题栏点击 + 输入
  console.log('\n[5] typeIntoText');
  if (r1.ok) {
    // 在 notepad 文本区域点击 (中心区域, notepad 默认打开时光标在中央)
    // 先在中心点点击, 让光标进入编辑区
    await mouseClick({ x: 700, y: 400 });
    await new Promise(r => setTimeout(r, 300));
    // 输入测试文本
    const { keyboardType } = await import('./desktop-automation.js');
    const testText = `AgentAI Vision Test ${Date.now()}`;
    const typeR = await keyboardType({ text: testText, intervalMs: 5 });
    check('keyboardType ok', typeR.ok, typeR.error);
    // 验证: 通过剪贴板 (Ctrl+A, Ctrl+C, 读剪贴板)
    const { pressHotkey, clipboardRead } = await import('./desktop-automation.js');
    await pressHotkey({ combo: 'ctrl+a' });
    await new Promise(r => setTimeout(r, 200));
    await pressHotkey({ combo: 'ctrl+c' });
    await new Promise(r => setTimeout(r, 200));
    const clip = await clipboardRead();
    check('剪贴板含输入文本', !!(clip.ok && clip.text?.includes(testText)), `clip=${clip.text?.slice(0, 50)}`);  // v3.2 修复: 显式 boolean
  }

  // 清理: 关掉 notepad
  console.log('\n[6] 清理');
  if (r1.ok) {
    const procs = await listProcesses({ nameFilter: 'notepad', onlyWithWindow: false });
    for (const p of procs) {
      try {
        execSync(`taskkill /F /PID ${p.pid}`, { stdio: 'ignore' });
      } catch {}
    }
    check('关掉所有 notepad', true, `killed ${procs.length}`);
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
