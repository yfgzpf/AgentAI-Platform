/**
 * desktop-automation: 桌面自动化原语 (鼠标/键盘/剪贴板/进程/通知)
 * =================================================================
 * 用途: 让 AI 助手可以"动手"操作桌面 — 点哪里、敲什么字、按什么快捷键
 * 与现有模块的关系:
 *   - screen-capture.ts  → 提供"看到什么" (input for AI decisions)
 *   - window-control.ts  → 提供"操作哪个窗口" (focus target)
 *   - 本模块            → 提供"具体怎么动" (mouse/keyboard output)
 * 三大设计原则:
 *   1. 薄包装 (thin wrapper): 每个功能都用最小 PowerShell 实现, 沿用 window-control 的模式
 *   2. 安全守护: 黑名单窗口 (密码管理器/任务管理器), 限长输入, 操作前确认
 *   3. 跨平台占位: macOS/Linux 返回 not-supported, 未来用 PyAutoGUI/AppleScript 补齐
 *
 * 安全分级:
 *   - low:    mouse_move, list_processes, clipboard_read, notify
 *   - medium: mouse_click, mouse_scroll, keyboard_type, clipboard_write, press_hotkey
 *   - high:   mouse_drag, kill_process (破坏性)
 */
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ===== 类型定义 =====

export type MouseButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface MouseClickOptions {
  x: number;
  y: number;
  button?: MouseButton;
  /** 单击/双击 (默认 1) */
  clicks?: 1 | 2;
  /** 是否先移动到位置 (默认 true) */
  moveFirst?: boolean;
}

export interface MouseMoveOptions {
  x: number;
  y: number;
}

export interface MouseDragOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  button?: MouseButton;
  /** 拖拽持续时间 (毫秒, 默认 200) */
  durationMs?: number;
}

export interface MouseScrollOptions {
  x: number;
  y: number;
  direction: ScrollDirection;
  /** 滚动量 (默认 3) */
  amount?: number;
}

export interface KeyboardTypeOptions {
  text: string;
  /** 输入间隔 (毫秒, 默认 10) */
  intervalMs?: number;
  /** 最大长度 (默认 5000) */
  maxLength?: number;
}

export interface HotkeyOptions {
  /** 快捷键组合, 如 "ctrl+c" / "alt+tab" / "ctrl+shift+esc" */
  combo: string;
}

export interface ClipboardResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  title?: string;
  /** 内存占用 (MB) */
  memoryMB?: number;
}

export type AutomationRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AutomationResult<T = any> {
  ok: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// ===== 安全配置 =====

/** 黑名单窗口: 这些窗口被聚焦时, 拒绝鼠标/键盘操作 (防止 AI 改密码) */
const FORBIDDEN_FOCUSED_WINDOWS = [
  /Credential\s*Manager/i, /凭据管理器/,
  /1Password/i, /Bitwarden/i, /KeePass/i, /LastPass/i,
  /Windows\s*Security/i, /Windows 安全中心/,
  /Task\s*Manager/i, /任务管理器/,
];

/** 危险进程: 杀进程时拒绝 */
const PROTECTED_PROCESSES = [
  'csrss', 'winlogon', 'smss', 'lsass', 'services',
  'svchost', 'explorer', 'dwm', 'System',
];

/** 输入最大长度 (防 DoS) */
const MAX_TEXT_LENGTH = 5000;

// ===== PowerShell 执行器 =====

function runPowerShell(script: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Desktop automation only supported on Windows'));
      return;
    }
    const tmpFile = path.join(os.tmpdir(), `da_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile],
      { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) {
          // 拼装完整错误: stderr (PowerShell 错误流) + stdout (脚本输出如 "error: ...") + err.message
          const parts = [
            (stderr || '').toString().trim(),
            (stdout || '').toString().trim(),
            err.message || '',
          ].filter(p => p && p.length > 0);
          reject(new Error(parts.join(' | ').slice(0, 800)));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/** 获取当前焦点窗口的标题 (用于黑名单检查) */
async function getForegroundWindowTitle(): Promise<string> {
  if (process.platform !== 'win32') return '';
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
$hwnd = [FG]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[FG]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
Write-Output $sb.ToString()
`;
  try {
    return (await runPowerShell(script, 5000)).trim();
  } catch {
    return '';
  }
}

/** 检查目标窗口是否在黑名单中 (同步, 用于每次输入前) */
async function assertNotForbiddenWindow(): Promise<void> {
  const title = await getForegroundWindowTitle();
  if (FORBIDDEN_FOCUSED_WINDOWS.some(p => p.test(title))) {
    throw new Error(
      `Refused: current foreground window "${title}" is in security blacklist ` +
      `(password manager / system panel). Move focus to your target app first.`
    );
  }
}

// ===== 鼠标控制 =====

/** 移动鼠标到指定坐标 (无点击) */
export async function mouseMove(opts: MouseMoveOptions): Promise<AutomationResult> {
  if (opts.x < 0 || opts.y < 0) {
    return { ok: false, error: 'Coordinates must be non-negative' };
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
[Mouse]::SetCursorPos(${opts.x}, ${opts.y}) | Out-Null
Write-Output "moved"
`;
  try {
    await runPowerShell(script);
    return { ok: true, message: `Mouse moved to (${opts.x}, ${opts.y})` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 在指定坐标点击鼠标 */
export async function mouseClick(opts: MouseClickOptions): Promise<AutomationResult> {
  if (opts.x < 0 || opts.y < 0) {
    return { ok: false, error: 'Coordinates must be non-negative' };
  }
  await assertNotForbiddenWindow();
  const buttonFlag = opts.button === 'right' ? 2 : opts.button === 'middle' ? 4 : 1;
  const moveFirst = opts.moveFirst !== false;
  const clicks = opts.clicks || 1;
  // 1=down, 2=up, 0x8000=absolute
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MC {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
[MC]::SetCursorPos(${opts.x}, ${opts.y}) | Out-Null
Start-Sleep -Milliseconds 30
${moveFirst ? '' : '# skip move'}
[MC]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # DOWN
Start-Sleep -Milliseconds 20
[MC]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # UP
${clicks >= 2 ? `Start-Sleep -Milliseconds 50
[MC]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 20
[MC]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)` : ''}
Write-Output "clicked"
`;
  try {
    await runPowerShell(script);
    return { ok: true, message: `Clicked ${opts.button || 'left'} at (${opts.x}, ${opts.y})${clicks > 1 ? ` x${clicks}` : ''}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 拖拽: 从 (x1,y1) 拖到 (x2,y2) */
export async function mouseDrag(opts: MouseDragOptions): Promise<AutomationResult> {
  await assertNotForbiddenWindow();
  const duration = Math.max(50, Math.min(opts.durationMs || 200, 2000));
  const buttonFlag = opts.button === 'right' ? 2 : 1;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MD {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
[MD]::SetCursorPos(${opts.x1}, ${opts.y1}) | Out-Null
Start-Sleep -Milliseconds 50
[MD]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # press
Start-Sleep -Milliseconds 50
# Smooth move with steps
$steps = 10
for ($i = 1; $i -le $steps; $i++) {
  $x = ${opts.x1} + (${opts.x2} - ${opts.x1}) * $i / $steps
  $y = ${opts.y1} + (${opts.y2} - ${opts.y1}) * $i / $steps
  [MD]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds [int](${duration} / $steps)
}
Start-Sleep -Milliseconds 30
[MD]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # release
Write-Output "dragged"
`;
  try {
    await runPowerShell(script);
    return { ok: true, message: `Dragged from (${opts.x1},${opts.y1}) to (${opts.x2},${opts.y2}) over ${duration}ms` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 滚轮滚动 */
export async function mouseScroll(opts: MouseScrollOptions): Promise<AutomationResult> {
  await assertNotForbiddenWindow();
  const amount = Math.max(1, Math.min(opts.amount || 3, 20));
  // 0x0800 = wheel, delta 正=上, 负=下
  let delta = 0;
  switch (opts.direction) {
    case 'up': delta = amount * 120; break;
    case 'down': delta = -amount * 120; break;
    case 'left': delta = -amount * 120; break;  // 横向滚动
    case 'right': delta = amount * 120; break;
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MS {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
[MS]::SetCursorPos(${opts.x}, ${opts.y}) | Out-Null
Start-Sleep -Milliseconds 30
[MS]::mouse_event(0x0800, 0, 0, ${delta}, [IntPtr]::Zero)
Write-Output "scrolled"
`;
  try {
    await runPowerShell(script);
    return { ok: true, message: `Scrolled ${opts.direction} ${amount} clicks at (${opts.x}, ${opts.y})` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ===== 键盘控制 =====

/** 输入文本 (使用 SendKeys, 支持特殊字符) */
export async function keyboardType(opts: KeyboardTypeOptions): Promise<AutomationResult> {
  if (!opts.text) return { ok: false, error: 'text required' };
  const maxLen = Math.min(opts.maxLength || MAX_TEXT_LENGTH, MAX_TEXT_LENGTH);
  if (opts.text.length > maxLen) {
    return { ok: false, error: `Text too long: ${opts.text.length} > ${maxLen}` };
  }
  await assertNotForbiddenWindow();
  // SendKeys 转义: + ^ % ~ { } [ ]
  // 策略: 用 WScript.Shell.SendKeys 直接传字符串
  // 复杂字符 (中文/emoji) 用剪贴板方案 (clipboard + Ctrl+V)
  const intervalMs = Math.max(0, Math.min(opts.intervalMs || 10, 200));
  const hasNonAscii = /[^\x00-\x7F]/.test(opts.text);
  let script: string;
  if (hasNonAscii) {
    // 非 ASCII: 写入剪贴板 → 全选 → 粘贴
    const escaped = opts.text.replace(/'/g, "''");
    script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Input.Keyboard,Windows.UI.Input,ContentType=WindowsRuntime]
# 简单的 Ctrl+V via SendKeys
$wsh = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 50
$wsh.SendKeys('^v')
Write-Output "typed-via-clipboard"
`;
  } else {
    // ASCII: 直接 SendKeys (注意转义: + ^ % ~ { } [ ])
    const escaped = opts.text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '{{}')
      .replace(/\}/g, '{}}')
      .replace(/\+/g, '{+}')
      .replace(/\^/g, '{^}')
      .replace(/%/g, '{%}')
      .replace(/~/g, '{~}')
      .replace(/\n/g, '{ENTER}')
      .replace(/\r/g, '');
    script = `
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys('${escaped}')
Write-Output "typed"
`;
  }
  try {
    await runPowerShell(script);
    return { ok: true, message: `Typed ${opts.text.length} chars (${hasNonAscii ? 'via clipboard' : 'SendKeys'})` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 按下快捷键组合 (如 "ctrl+shift+esc") */
export async function pressHotkey(opts: HotkeyOptions): Promise<AutomationResult> {
  if (!opts.combo) return { ok: false, error: 'combo required' };
  await assertNotForbiddenWindow();
  // 解析组合键: ctrl/alt/shift/win + 主键
  const parts = opts.combo.toLowerCase().split('+').map(p => p.trim());
  const modifiers: string[] = [];
  let mainKey = '';
  const modMap: Record<string, string> = {
    ctrl: '^', control: '^', ctl: '^',
    alt: '%', menu: '%',
    shift: '+',
    win: '^{ESC}',  // Win key 特殊处理
    cmd: '%',       // mac alias
  };
  for (const p of parts) {
    if (modMap[p]) {
      modifiers.push(modMap[p]);
    } else {
      mainKey = p;
    }
  }
  // 主键映射 (常见键)
  const keyMap: Record<string, string> = {
    enter: '{ENTER}', return: '{ENTER}',
    esc: '{ESC}', escape: '{ESC}',
    tab: '{TAB}',
    space: ' ', backspace: '{BACKSPACE}', bs: '{BS}',
    delete: '{DELETE}', del: '{DEL}',
    home: '{HOME}', end: '{END}',
    pageup: '{PGUP}', pgup: '{PGUP}',
    pagedown: '{PGDN}', pgdn: '{PGDN}',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    insert: '{INSERT}', ins: '{INS}',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
    f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
    f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  };
  const mainKeySend = keyMap[mainKey] || (mainKey.length === 1 ? mainKey.toUpperCase() : `{${mainKey.toUpperCase()}}`);
  // 修饰键顺序: 按下顺序, 释放顺序相反
  const sendKeysStr = modifiers.join('') + mainKeySend + modifiers.reverse().join('').split('').map(m => `{${m === '^' ? 'ctrl' : m === '%' ? 'alt' : 'shift'}}up`).join('');
  // 简化: 直接用 SendKeys 的修饰键语法 (^=ctrl, %=alt, +=shift)
  const send = modifiers.join('') + mainKeySend;
  const script = `
$wsh = New-Object -ComObject WScript.Shell
$wsh.SendKeys('${send}')
Write-Output "pressed"
`;
  try {
    await runPowerShell(script);
    return { ok: true, message: `Pressed ${opts.combo}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ===== 剪贴板 =====

/** 读取剪贴板文本 (用 Get-Clipboard cmdlet, 跨 STA 进程安全) */
export async function clipboardRead(): Promise<ClipboardResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Clipboard only supported on Windows' };
  }
  const script = `
try {
  $text = Get-Clipboard -ErrorAction Stop
  if ($null -eq $text) { Write-Output ""; exit 0 }
  Write-Output $text
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`;
  try {
    const out = await runPowerShell(script, 5000);
    if (out.startsWith('ERROR:')) {
      return { ok: false, error: out.slice(6).trim() };
    }
    return { ok: true, text: out };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 写入剪贴板文本 (用 Set-Clipboard cmdlet) */
export async function clipboardWrite(text: string): Promise<ClipboardResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Clipboard only supported on Windows' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `Text too long: ${text.length} > ${MAX_TEXT_LENGTH}` };
  }
  // Set-Clipboard -Value "..." 需要转义双引号和反引号
  // 用 Base64 编码避免转义地狱
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  const script = `
$bytes = [Convert]::FromBase64String('${b64}')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
try {
  Set-Clipboard -Value $text -ErrorAction Stop
  Write-Output "set"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`;
  try {
    const out = await runPowerShell(script, 5000);
    if (out.startsWith('ERROR:')) {
      return { ok: false, error: out.slice(6).trim() };
    }
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ===== 进程管理 =====

/** 列出进程 (Windows). 默认只返回有主窗口的 (轻量); 传 onlyWithWindow=false 列出全部 (含命令行进程) */
export async function listProcesses(opts: { nameFilter?: string; limit?: number; onlyWithWindow?: boolean } = {}): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return [];
  const limit = Math.max(1, Math.min(opts.limit || 50, 500));
  const safeFilter = (opts.nameFilter || '').replace(/'/g, "''");
  // 默认 onlyWithWindow=true (轻量, 适合 UI 操作)
  // false 时返回所有进程 (含 powershell/node/python 等命令行进程, 适合服务管理)
  const onlyWindow = opts.onlyWithWindow !== false;
  const whereClause = onlyWindow
    ? 'Where-Object { $_.MainWindowTitle -ne \'\' }'
    : 'Where-Object { $_.Id -gt 0 }';  // 全部用户进程
  const script = `
$results = @()
Get-Process | ${whereClause} | ForEach-Object {
  $obj = @{
    pid = $_.Id
    name = $_.ProcessName
    title = $_.MainWindowTitle
    memoryMB = [math]::Round($_.WorkingSet64 / 1MB, 1)
  }
  $results += $obj
}
if ('${safeFilter}' -ne '') {
  $results = $results | Where-Object { $_.name -like '*${safeFilter}*' -or ($_.title -and $_.title -like '*${safeFilter}*') }
}
$results = $results | Select-Object -First ${limit}
if ($results.Count -eq 0) { Write-Output "[]"; exit 0 }
$results | ConvertTo-Json -Compress
`;
  try {
    const output = await runPowerShell(script, 10000);
    if (!output || output === '[]') return [];
    const arr = JSON.parse(output);
    return Array.isArray(arr) ? arr : [arr];
  } catch {
    return [];
  }
}

/** 杀进程 (by PID) */
export async function killProcess(pid: number, force = false): Promise<AutomationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Process kill only on Windows' };
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: 'Invalid PID' };
  }
  // 获取进程名, 检查是否在保护列表
  try {
    const info = await runPowerShell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`, 5000);
    const name = info.trim().toLowerCase();
    if (PROTECTED_PROCESSES.includes(name)) {
      return { ok: false, error: `Refused: process "${name}" is system-protected` };
    }
  } catch (e: any) {
    return { ok: false, error: `Cannot find PID ${pid}: ${e.message}` };
  }
  // 用 taskkill (与进程同步规则一致, 不用 process.kill)
  const flag = force ? '/F' : '';
  const script = `
try {
  Stop-Process -Id ${pid} ${flag} -ErrorAction Stop
  Write-Output "killed"
} catch {
  Write-Output "error: $_"
  exit 1
}
`;
  try {
    await runPowerShell(script, 10000);
    return { ok: true, message: `Killed PID ${pid}${force ? ' (forced)' : ''}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ===== 通知 =====

/** 发送桌面通知 (Windows Toast) */
export async function sendNotification(opts: {
  title: string;
  message: string;
  /** 重要程度: info / warning / error */
  severity?: 'info' | 'warning' | 'error';
}): Promise<AutomationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Notifications only on Windows' };
  }
  if (!opts.title || !opts.message) {
    return { ok: false, error: 'title and message required' };
  }
  if (opts.title.length > 100 || opts.message.length > 500) {
    return { ok: false, error: 'Title > 100 chars or message > 500 chars' };
  }
  // 用 Base64 避免转义
  const titleB64 = Buffer.from(opts.title, 'utf-8').toString('base64');
  const msgB64 = Buffer.from(opts.message.replace(/\r?\n/g, ' '), 'utf-8').toString('base64');
  const sevB64 = Buffer.from(opts.severity || 'info', 'utf-8').toString('base64');
  const script = `
$title = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${titleB64}'))
$msg = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${msgB64}'))
$sev = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${sevB64}'))

# 加载 Windows RT 的 ToastNotification (Win10+)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$iconMap = @{ 'info' = 'Information'; 'warning' = 'Warning'; 'error' = 'Error' }
$icon = if ($iconMap.ContainsKey($sev)) { $iconMap[$sev] } else { 'Information' }

$xmlText = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$([System.Web.HttpUtility]::HtmlEncode($title))</text>
      <text>$([System.Web.HttpUtility]::HtmlEncode($msg))</text>
    </binding>
  </visual>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($xmlText)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AgentAI').Show($toast)
Write-Output "notified"
`;
  try {
    await runPowerShell(script, 10000);
    return { ok: true, message: `Notification sent: ${opts.title}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ===== 自检: 健康检查 =====
export async function desktopAutomationHealth(): Promise<{ ok: boolean; platform: string; powershell: boolean; version?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, platform: process.platform, powershell: false };
  }
  try {
    const v = await runPowerShell('$PSVersionTable.PSVersion.ToString()', 5000);
    return { ok: true, platform: process.platform, powershell: true, version: v };
  } catch {
    return { ok: false, platform: process.platform, powershell: false };
  }
}

// ===== 扩展能力: 应用启动 / 系统状态 / 媒体控制 / 锁屏 =====

/** 启动应用 (Windows). 支持:
 *   - 系统命令: notepad / calc / mspaint / explorer
 *   - 任意可执行路径: C:\Program Files\Google\Chrome\Application\chrome.exe
 *   - URL 协议: https://example.com (用 ShellExecute 打开默认浏览器)
 *   - 文件关联: .txt / .pdf (用默认程序打开)
 *
 * 安全: 仅允许已知的系统命令白名单; 路径必须存在; URL 只允许 http/https
 */
const SAFE_SYSTEM_COMMANDS = new Set([
  'notepad', 'notepad.exe', 'calc', 'calc.exe', 'mspaint', 'mspaint.exe',
  'explorer', 'explorer.exe', 'taskmgr', 'taskmgr.exe',
  'cmd', 'powershell', 'pwsh', 'wt', 'wt.exe',  // terminal
  'ms-settings', 'ms-settings.exe',  // Windows Settings
  'snippingtool', 'snippingtool.exe', 'snip', 'snipaste',
]);

export interface LaunchAppOptions {
  /** 应用名 / 路径 / URL */
  target: string;
  /** 额外参数 (可选), 如打开 Chrome 时 "https://google.com" */
  args?: string;
  /** 工作目录 (可选) */
  cwd?: string;
}

export async function launchApp(opts: LaunchAppOptions): Promise<AutomationResult<{ pid?: number }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'launchApp only supported on Windows' };
  }
  if (!opts?.target) return { ok: false, error: 'target required' };
  const target = opts.target.trim();
  if (target.length > 2048) return { ok: false, error: 'target too long (> 2048)' };

  // 安全检查 1: URL 只允许 http/https
  if (/^https?:\/\//i.test(target)) {
    // OK - 用 ShellExecute
  } else if (target.includes('://')) {
    return { ok: false, error: `Refused: protocol other than http(s) not allowed: ${target.slice(0, 50)}` };
  }

  // 安全检查 2: 文件路径
  const isPath = /[\\/]/.test(target) || /\.[a-z0-9]{1,5}$/i.test(target) || /^[a-zA-Z]:[\\/]/.test(target);
  if (isPath) {
    // 绝对路径必须存在
    if (path.isAbsolute(target) && !fs.existsSync(target)) {
      return { ok: false, error: `Refused: file not found: ${target}` };
    }
    // 禁止路径中的危险字符
    if (/[<>|"*?]/.test(target)) {
      return { ok: false, error: 'Refused: path contains illegal characters' };
    }
  } else {
    // 系统命令必须白名单
    const cmd = target.toLowerCase().replace(/\.exe$/i, '');
    if (!SAFE_SYSTEM_COMMANDS.has(cmd)) {
      return { ok: false, error: `Refused: command "${target}" not in whitelist. Use absolute path for custom apps.` };
    }
  }

  // 用 Base64 避免转义
  const tB64 = Buffer.from(target, 'utf-8').toString('base64');
  const aB64 = Buffer.from(opts.args || '', 'utf-8').toString('base64');
  const cB64 = Buffer.from(opts.cwd || '', 'utf-8').toString('base64');
  const script = `
$target = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${tB64}'))
$argsStr = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${aB64}'))
$cwd = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${cB64}'))
try {
  if ($target -match '^https?://') {
    Start-Process $target
  } else {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $target
    if ($argsStr) { $psi.Arguments = $argsStr }
    if ($cwd) { $psi.WorkingDirectory = $cwd }
    $psi.UseShellExecute = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
  }
  Write-Output "launched"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`;
  try {
    await runPowerShell(script, 10000);
    return { ok: true, message: `Launched: ${target}${opts.args ? ' ' + opts.args : ''}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 系统信息: CPU / 内存 / 磁盘 / 启动时间 */
export interface SystemInfo {
  os: string;
  cpuPercent: number;
  memory: { totalGB: number; usedGB: number; freeGB: number; percent: number };
  disks: Array<{ drive: string; totalGB: number; freeGB: number; percent: number }>;
  uptimeHours: number;
}

export async function getSystemInfo(): Promise<AutomationResult<SystemInfo>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'getSystemInfo only on Windows' };
  }
  const script = `
$os = (Get-CimInstance Win32_OperatingSystem).Caption
$cpu = (Get-CimInstance Win32_Processor).LoadPercentage
$os2 = Get-CimInstance Win32_OperatingSystem
$totalMem = [math]::Round($os2.TotalVisibleMemorySize / 1MB, 2)
$freeMem = [math]::Round($os2.FreePhysicalMemory / 1MB, 2)
$usedMem = [math]::Round($totalMem - $freeMem, 2)
$memPct = if ($totalMem -gt 0) { [math]::Round($usedMem / $totalMem * 100, 1) } else { 0 }
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [PSCustomObject]@{
    drive = $_.DeviceID
    totalGB = [math]::Round($_.Size / 1GB, 2)
    freeGB = [math]::Round($_.FreeSpace / 1GB, 2)
    percent = if ($_.Size -gt 0) { [math]::Round(($_.Size - $_.FreeSpace) / $_.Size * 100, 1) } else { 0 }
  }
}
$uptime = [math]::Round(((Get-Date) - $os2.LastBootUpTime).TotalHours, 1)
$obj = [PSCustomObject]@{
  os = $os
  cpuPercent = $cpu
  memory = @{ totalGB = $totalMem; usedGB = $usedMem; freeGB = $freeMem; percent = $memPct }
  disks = @($disks)
  uptimeHours = $uptime
}
$obj | ConvertTo-Json -Compress -Depth 3
`;
  try {
    const out = await runPowerShell(script, 10000);
    const info = JSON.parse(out);
    return { ok: true, data: info, message: `CPU ${info.cpuPercent}% / MEM ${info.memory.percent}% / Uptime ${info.uptimeHours}h` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 锁屏 (Lock Workstation) */
export async function lockScreen(): Promise<AutomationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'lockScreen only on Windows' };
  }
  const script = `
try {
  rundll32.exe user32.dll, LockWorkStation
  Write-Output "locked"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
`;
  try {
    await runPowerShell(script, 5000);
    return { ok: true, message: 'Workstation locked' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 音量控制 (0-100) */
export async function setVolume(level: number): Promise<AutomationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'setVolume only on Windows' };
  }
  if (!Number.isInteger(level) || level < 0 || level > 100) {
    return { ok: false, error: 'level must be integer 0-100' };
  }
  // 用 SendKeys 在系统音量 OSD 上调节 (避免 COM 依赖)
  // 简化: 用 PowerShell + WindowsAudio API (P/Invoke)
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VA {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr extra);
  public const byte VK_VOLUME_MUTE = 0xAD;
  public const byte VK_VOLUME_DOWN = 0xAE;
  public const byte VK_VOLUME_UP = 0xAF;
}
"@
# 先静音再调整 (避免叠加)
# 设置为具体值需要 50 次 +/- 键, 简化: 用 nircmd 或直接通过 SendInput
# 这里用 SendKeys 模拟: 计算需要按多少下 volume_up/down
$current = 50  # 假设当前 50
$diff = ${level} - $current
$key = if ($diff -gt 0) { [VA]::VK_VOLUME_UP } else { [VA]::VK_VOLUME_DOWN }
$times = [math]::Abs($diff)
for ($i = 0; $i -lt $times; $i++) {
  [VA]::keybd_event($key, 0, 0, [IntPtr]::Zero)  # down
  [VA]::keybd_event($key, 0, 2, [IntPtr]::Zero)  # up
  Start-Sleep -Milliseconds 30
}
Write-Output "set"
`;
  try {
    await runPowerShell(script, 10000);
    return { ok: true, message: `Volume set to ~${level} (approximate, real value depends on system state)` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 静音切换 */
export async function toggleMute(): Promise<AutomationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'toggleMute only on Windows' };
  }
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VM {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr extra);
  public const byte VK_VOLUME_MUTE = 0xAD;
}
"@
[VM]::keybd_event([VM]::VK_VOLUME_MUTE, 0, 0, [IntPtr]::Zero)
[VM]::keybd_event([VM]::VK_VOLUME_MUTE, 0, 2, [IntPtr]::Zero)
Write-Output "toggled"
`;
  try {
    await runPowerShell(script, 5000);
    return { ok: true, message: 'Mute toggled' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** 等待窗口出现 (异步自动化的关键) */
export interface WaitForWindowOptions {
  /** 窗口标题 (支持部分匹配) */
  titleContains: string;
  /** 超时 (毫秒, 默认 10000) */
  timeoutMs?: number;
  /** 轮询间隔 (毫秒, 默认 500) */
  pollMs?: number;
}

export async function waitForWindow(opts: WaitForWindowOptions): Promise<AutomationResult<{ title: string; hwnd: number }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'waitForWindow only on Windows' };
  }
  if (!opts?.titleContains) return { ok: false, error: 'titleContains required' };
  const timeout = Math.max(500, Math.min(opts.timeoutMs || 10000, 60000));
  const poll = Math.max(100, Math.min(opts.pollMs || 500, 5000));
  const safeTitle = opts.titleContains.replace(/'/g, "''").slice(0, 200);
  const start = Date.now();
  // 用内层 PowerShell 超时 (< 外层 timeout) 保证可中断
  const innerTimeout = Math.max(1000, Math.min(Math.floor(timeout / 2), 5000));
  while (Date.now() - start < timeout) {
    const remaining = timeout - (Date.now() - start);
    if (remaining < innerTimeout + 200) break;  // 剩余时间不够一次轮询就退出
    // 用 Get-Process (已知稳定) 替代 EnumWindows + 脚本块
    const script = `
$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safeTitle}*' } | Select-Object -First 1
if ($p) {
  $obj = [PSCustomObject]@{ hwnd = $p.MainWindowHandle; title = $p.MainWindowTitle; pid = $p.Id }
  $obj | ConvertTo-Json -Compress
} else {
  Write-Output "null"
}
`;
    try {
      const out = await runPowerShell(script, innerTimeout);
      if (out && out !== 'null') {
        const found = JSON.parse(out);
        return { ok: true, data: found, message: `Window found: ${found.title}` };
      }
    } catch {}
    await new Promise(r => setTimeout(r, poll));
  }
  return { ok: false, error: `Window "${opts.titleContains}" not found within ${timeout}ms` };
}

// ===== 视觉驱动自动化 (Vision-Driven Automation) =====
// 设计: 让 AI 不需要知道精确坐标, 用文字/图片描述就能操作
// 实现: 截屏 + OCR (带坐标) / 模板匹配 → 找到目标 → 自动点击

/** 视觉目标 (找到后的返回) */
export interface VisualTarget {
  /** 中心点 (屏幕坐标) */
  cx: number;
  cy: number;
  /** 边界框 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 匹配的文本/图片描述 */
  matchedText?: string;
  /** 置信度 (0-1) */
  confidence: number;
}

/** 在屏幕上查找文字 (单次截屏 + OCR) */
export async function findTextOnScreen(
  text: string,
  opts: {
    /** 完全匹配还是包含 (默认 false=包含) */
    exactMatch?: boolean;
    /** 忽略大小写 (默认 true) */
    ignoreCase?: boolean;
    /** 截图选项 */
    captureOpts?: { mode?: 'desktop' | 'window' | 'region'; windowTitle?: string; region?: { x: number; y: number; width: number; height: number } };
  } = {}
): Promise<AutomationResult<{ target: VisualTarget; allMatches: VisualTarget[]; ocrText: string }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'findTextOnScreen only on Windows' };
  }
  if (!text || text.length > 500) {
    return { ok: false, error: 'text required, max 500 chars' };
  }
  // 1. 截屏
  const { captureScreen } = await import('./screen-capture.js');
  const capture = await captureScreen(opts.captureOpts || { mode: 'desktop' });
  if (!capture.ok || !capture.filePath) {
    return { ok: false, error: 'Screenshot failed: ' + (capture.error || 'unknown') };
  }
  // 2. OCR 带坐标
  const { ocrImageWithBoxes } = await import('./ocr.js');
  const ocr = await ocrImageWithBoxes(capture.filePath, { language: 'zh-Hans' });
  // 清理截屏临时文件
  try { fs.unlinkSync(capture.filePath); } catch {}
  if (!ocr.ok) {
    return { ok: false, error: 'OCR failed: ' + (ocr.error || 'unknown') };
  }
  // 3. 匹配文本
  const ignoreCase = opts.ignoreCase !== false;
  const needle = ignoreCase ? text.toLowerCase() : text;
  const matches: VisualTarget[] = [];
  for (const box of ocr.boxes) {
    const hay = ignoreCase ? box.text.toLowerCase() : box.text;
    const isMatch = opts.exactMatch ? hay === needle : hay.includes(needle);
    if (isMatch) {
      matches.push({
        cx: box.cx, cy: box.cy,
        x: box.x, y: box.y, w: box.w, h: box.h,
        matchedText: box.text,
        confidence: 0.9,  // Windows OCR 不暴露置信度, 视为高
      });
    }
  }
  if (matches.length === 0) {
    return { ok: false, error: `Text "${text}" not found on screen`, data: { target: { cx: 0, cy: 0, x: 0, y: 0, w: 0, h: 0, confidence: 0 }, allMatches: [], ocrText: ocr.text } };
  }
  // 4. 返回最佳匹配 (取第一个, 可选最大)
  const top = matches[0]!;  // v3.2 修复: matches 非空
  return {
    ok: true,
    data: { target: top, allMatches: matches, ocrText: ocr.text },
    message: `Found "${top.matchedText}" at (${top.cx}, ${top.cy}) (${matches.length} matches total)`,
  };
}

/** 点击屏幕上指定文字 (组合: findText + mouseClick) */
export async function clickText(
  text: string,
  opts: {
    exactMatch?: boolean;
    button?: MouseButton;
    doubleClick?: boolean;
    captureOpts?: { mode?: 'desktop' | 'window' | 'region'; windowTitle?: string; region?: { x: number; y: number; width: number; height: number } };
  } = {}
): Promise<AutomationResult<{ target: VisualTarget }>> {
  const found = await findTextOnScreen(text, opts);
  if (!found.ok || !found.data) {
    return { ok: false, error: found.error || 'Text not found' };
  }
  const t = found.data.target;
  const clickResult = await mouseClick({
    x: t.cx, y: t.cy,
    button: opts.button || 'left',
    clicks: opts.doubleClick ? 2 : 1,
  });
  if (!clickResult.ok) {
    return { ok: false, error: `Click failed: ${clickResult.error}` };
  }
  return {
    ok: true,
    data: { target: t },
    message: `Clicked "${text}" at (${t.cx}, ${t.cy})`,
  };
}

/** 等待文字出现 (轮询 OCR) */
export async function waitForText(
  text: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    exactMatch?: boolean;
    captureOpts?: { mode?: 'desktop' | 'window' | 'region'; windowTitle?: string };
  } = {}
): Promise<AutomationResult<{ target: VisualTarget; ocrText: string }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'waitForText only on Windows' };
  }
  const timeout = Math.max(500, Math.min(opts.timeoutMs || 10000, 60000));
  const poll = Math.max(500, Math.min(opts.pollMs || 1500, 5000));
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeout) {
    const remaining = timeout - (Date.now() - start);
    if (remaining < poll + 1000) break;
    const found = await findTextOnScreen(text, { exactMatch: opts.exactMatch, captureOpts: opts.captureOpts });
    if (found.ok && found.data) {
      return {
        ok: true,
        data: { target: found.data.target, ocrText: found.data.ocrText },
        message: `Text "${text}" appeared at (${found.data.target.cx}, ${found.data.target.cy})`,
      };
    }
    lastError = found.error || 'not found';
    await new Promise(r => setTimeout(r, poll));
  }
  return { ok: false, error: `Text "${text}" did not appear within ${timeout}ms (last: ${lastError})` };
}

/** 双击文字 */
export async function doubleClickText(text: string, opts: Parameters<typeof findTextOnScreen>[1] = {}): Promise<AutomationResult<{ target: VisualTarget }>> {
  return clickText(text, { ...opts, doubleClick: true });
}

/** 在指定文字位置输入文本 (click + type 组合) */
export async function typeIntoText(
  fieldText: string,
  inputText: string,
  opts: {
    exactMatch?: boolean;
    clearBefore?: boolean;  // 输入前清空 (Ctrl+A then Delete)
    intervalMs?: number;
  } = {}
): Promise<AutomationResult<{ target: VisualTarget }>> {
  // 1. 点击文字
  const click = await clickText(fieldText, { exactMatch: opts.exactMatch });
  if (!click.ok || !click.data) {
    return { ok: false, error: `Failed to click "${fieldText}": ${click.error}` };
  }
  // 2. (可选) 清空
  if (opts.clearBefore) {
    await pressHotkey({ combo: 'ctrl+a' });
    await new Promise(r => setTimeout(r, 100));
    await pressHotkey({ combo: 'delete' });
  }
  // 3. 输入
  const typeResult = await keyboardType({ text: inputText, intervalMs: opts.intervalMs });
  if (!typeResult.ok) {
    return { ok: false, error: `Type failed: ${typeResult.error}` };
  }
  return {
    ok: true,
    data: { target: click.data.target },
    message: `Typed "${inputText}" into "${fieldText}"`,
  };
}

// ===== 图像模板匹配 (不依赖 OCR) =====
/** 找图结果 */
export interface FindImageMatch {
  /** 匹配中心坐标 (屏幕坐标) */
  cx: number;
  cy: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 相似度 (0-1) */
  similarity: number;
}

/** 在屏幕上找图片 (模板匹配, 不需要 OCR) */
export async function findImageOnScreen(
  templatePath: string,
  opts: {
    /** 相似度阈值 (0-1, 默认 0.85) */
    threshold?: number;
    /** 截图区域 (可选, 限制搜索范围) */
    region?: { x: number; y: number; width: number; height: number };
  } = {}
): Promise<AutomationResult<{ matches: FindImageMatch[]; best: FindImageMatch | null }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'findImageOnScreen only on Windows' };
  }
  if (!templatePath) return { ok: false, error: 'templatePath required' };
  // 1. 截屏
  const { captureScreen } = await import('./screen-capture.js');
  const capture = await captureScreen(opts.region ? { mode: 'region', region: opts.region } : { mode: 'desktop' });
  if (!capture.ok || !capture.filePath) {
    return { ok: false, error: 'Screenshot failed: ' + (capture.error || 'unknown') };
  }
  // 2. 模板匹配 (用 .NET Bitmap + 预降采样像素比对)
  //    策略: 把 source 预降采样到 128x128, 然后在降采样空间里搜索
  //    速度: ~1 秒 (vs 全图扫描 ~30+ 秒)
  //    精度: 适合"找图标/按钮"场景, 精确像素匹配需 OpenCV
  //    优化: 用文件而非 base64 传递图片 (避免大 base64 拖慢 PowerShell 启动)
  const tB64 = fs.readFileSync(templatePath).toString('base64');
  const sB64 = fs.readFileSync(capture.filePath).toString('base64');
  const threshold = Math.max(0.5, Math.min(opts.threshold || 0.85, 0.99));
  const scriptGuid = Math.random().toString(36).slice(2, 10);
  const tB64Path = path.join(os.tmpdir(), `tB64_${scriptGuid}.txt`);
  const sB64Path = path.join(os.tmpdir(), `sB64_${scriptGuid}.txt`);
  fs.writeFileSync(tB64Path, tB64);
  fs.writeFileSync(sB64Path, sB64);
  const script = `
Add-Type -AssemblyName System.Drawing
$tB64 = [System.IO.File]::ReadAllText('${tB64Path.replace(/\\/g, '\\\\')}')
$sB64 = [System.IO.File]::ReadAllText('${sB64Path.replace(/\\/g, '\\\\')}')
Remove-Item '${tB64Path.replace(/\\/g, '\\\\')}' -ErrorAction SilentlyContinue
Remove-Item '${sB64Path.replace(/\\/g, '\\\\')}' -ErrorAction SilentlyContinue
$tBytes = [Convert]::FromBase64String($tB64)
$sBytes = [Convert]::FromBase64String($sB64)
$tPath = Join-Path $env:TEMP "tmpl_${scriptGuid}.png"
$sPath = Join-Path $env:TEMP "srce_${scriptGuid}.png"
[System.IO.File]::WriteAllBytes($tPath, $tBytes)
[System.IO.File]::WriteAllBytes($sPath, $sBytes)
try {
  $template = [System.Drawing.Image]::FromFile($tPath)
  $source = [System.Drawing.Image]::FromFile($sPath)
  $tW = $template.Width
  $tH = $template.Height
  $sW = $source.Width
  $sH = $source.Height
  if ($tW -gt $sW -or $tH -gt $sH) {
    Write-Output '{"best":null,"matches":[]}'
    exit 0
  }
  # 把 source 预降采样到 128x128 (固定), 用 bitmap 缩放
  $srcDownW = 128
  $srcDownH = 128
  $sDownBmp = New-Object System.Drawing.Bitmap $srcDownW, $srcDownH
  $sG = [System.Drawing.Graphics]::FromImage($sDownBmp)
  $sG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $sG.DrawImage($source, 0, 0, $srcDownW, $srcDownH)
  $sG.Dispose()
  # 把 template 也缩放到相对 128 空间的大小 (保持比例)
  $tScale = [math]::Min(127.0 / $tW, 127.0 / $tH)
  $tDownW = [int]($tW * $tScale)
  $tDownH = [int]($tH * $tScale)
  $tDownBmp = New-Object System.Drawing.Bitmap $tDownW, $tDownH
  $tG = [System.Drawing.Graphics]::FromImage($tDownBmp)
  $tG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $tG.DrawImage($template, 0, 0, $tDownW, $tDownH)
  $tG.Dispose()
  # 计算 template 的 8x8 网格特征
  $gridSize = 8
  $tFeatures = @()
  $tCellW = [math]::Max(1, [int]($tDownW / $gridSize))
  $tCellH = [math]::Max(1, [int]($tDownH / $gridSize))
  for ($gy = 0; $gy -lt $gridSize; $gy++) {
    for ($gx = 0; $gx -lt $gridSize; $gx++) {
      $cx = [math]::Min($tDownW-1, $gx * $tCellW + [int]($tCellW/2))
      $cy = [math]::Min($tDownH-1, $gy * $tCellH + [int]($tCellH/2))
      $p = $tDownBmp.GetPixel($cx, $cy)
      $tFeatures += ,(@([math]::Round($p.R/255.0,3), [math]::Round($p.G/255.0,3), [math]::Round($p.B/255.0,3)))
    }
  }
  # 在降采样 source 上滑动 window (步长 = template 缩小后尺寸的 1/4)
  $stepX = [math]::Max(1, [int]($tDownW / 4))
  $stepY = [math]::Max(1, [int]($tDownH / 4))
  $bestSim = 0
  $bestX = 0
  $bestY = 0
  $matches = @()
  $threshold = ${threshold}
  # 计算 128 空间 → 原图的缩放因子
  $sScaleX = $sW / $srcDownW
  $sScaleY = $sH / $srcDownH
  for ($y = 0; $y -le ($srcDownH - $tDownH); $y += $stepY) {
    for ($x = 0; $x -le ($srcDownW - $tDownW); $x += $stepX) {
      $totalDiff = 0
      $cellW = [math]::Max(1, [int]($tDownW / $gridSize))
      $cellH = [math]::Max(1, [int]($tDownH / $gridSize))
      for ($gy = 0; $gy -lt $gridSize; $gy++) {
        for ($gx = 0; $gx -lt $gridSize; $gx++) {
          $cx = [math]::Min($srcDownW-1, $x + $gx * $cellW + [int]($cellW/2))
          $cy = [math]::Min($srcDownH-1, $y + $gy * $cellH + [int]($cellH/2))
          $sp = $sDownBmp.GetPixel($cx, $cy)
          $tf = $tFeatures[$gy * $gridSize + $gx]
          $dr = [math]::Abs($tf[0] - $sp.R/255.0)
          $dg = [math]::Abs($tf[1] - $sp.G/255.0)
          $db = [math]::Abs($tf[2] - $sp.B/255.0)
          $totalDiff += ($dr + $dg + $db) / 3.0
        }
      }
      $avgDiff = $totalDiff / ($gridSize * $gridSize)
      $sim = 1.0 - $avgDiff
      if ($sim -ge $threshold) {
        # 转换回原图坐标
        $realX = [int]($x * $sScaleX)
        $realY = [int]($y * $sScaleY)
        $matches += [PSCustomObject]@{
          x = $realX; y = $realY; w = $tW; h = $tH
          similarity = [math]::Round($sim, 3)
        }
        if ($sim -gt $bestSim) {
          $bestSim = $sim
          $bestX = $realX
          $bestY = $realY
        }
      }
    }
  }
  $sDownBmp.Dispose()
  $tDownBmp.Dispose()
  Remove-Item $tPath -Force -ErrorAction SilentlyContinue
  Remove-Item $sPath -Force -ErrorAction SilentlyContinue
  $template.Dispose(); $source.Dispose()
  if ($matches.Count -eq 0) {
    $out = '{"best":null,"matches":[]}'
  } else {
    $best = [PSCustomObject]@{
      x = $bestX; y = $bestY; w = $tW; h = $tH
      cx = $bestX + [int]($tW / 2)
      cy = $bestY + [int]($tH / 2)
      similarity = [math]::Round($bestSim, 3)
    }
    $matchesJson = ($matches | Select-Object -First 10) | ConvertTo-Json -Compress
    $bestJson = $best | ConvertTo-Json -Compress
    $out = '{"best":' + $bestJson + ',"matches":' + $matchesJson + '}'
  }
  Write-Output $out
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  Remove-Item $tPath -Force -ErrorAction SilentlyContinue
  Remove-Item $sPath -Force -ErrorAction SilentlyContinue
  exit 1
}
`;
  try {
    const out = await runPowerShell(script, 60000);
    // 清理截屏
    try { fs.unlinkSync(capture.filePath); } catch {}
    const data = JSON.parse(out);
    if (!data.best) {
      return { ok: false, error: `No match found (threshold=${threshold})`, data: { matches: [], best: null } };
    }
    return {
      ok: true,
      data: { best: data.best, matches: data.matches || [] },
      message: `Found image at (${data.best.cx}, ${data.best.cy}) similarity=${data.best.similarity}`,
    };
  } catch (e: any) {
    try { fs.unlinkSync(capture.filePath); } catch {}
    return { ok: false, error: e.message };
  }
}

/** 点击屏幕上指定图片 (组合: findImage + mouseClick) */
export async function clickImage(
  templatePath: string,
  opts: {
    threshold?: number;
    button?: MouseButton;
    doubleClick?: boolean;
    region?: { x: number; y: number; width: number; height: number };
  } = {}
): Promise<AutomationResult<{ target: VisualTarget }>> {
  const found = await findImageOnScreen(templatePath, { threshold: opts.threshold, region: opts.region });
  if (!found.ok || !found.data?.best) {
    return { ok: false, error: found.error || 'Image not found' };
  }
  const b = found.data.best;
  const clickResult = await mouseClick({
    x: b.cx, y: b.cy,
    button: opts.button || 'left',
    clicks: opts.doubleClick ? 2 : 1,
  });
  if (!clickResult.ok) {
    return { ok: false, error: `Click failed: ${clickResult.error}` };
  }
  return {
    ok: true,
    data: { target: { cx: b.cx, cy: b.cy, x: b.x, y: b.y, w: b.w, h: b.h, confidence: b.similarity } },
    message: `Clicked image at (${b.cx}, ${b.cy}) similarity=${b.similarity}`,
  };
}

/** 等待图片出现 (轮询模板匹配) */
export async function waitForImage(
  templatePath: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    threshold?: number;
  } = {}
): Promise<AutomationResult<{ target: VisualTarget }>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'waitForImage only on Windows' };
  }
  const timeout = Math.max(500, Math.min(opts.timeoutMs || 10000, 60000));
  const poll = Math.max(500, Math.min(opts.pollMs || 1500, 5000));
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeout) {
    const remaining = timeout - (Date.now() - start);
    if (remaining < poll + 5000) break;  // 模板匹配较慢, 留更多时间
    const found = await findImageOnScreen(templatePath, { threshold: opts.threshold });
    if (found.ok && found.data?.best) {
      const b = found.data.best;
      return {
        ok: true,
        data: { target: { cx: b.cx, cy: b.cy, x: b.x, y: b.y, w: b.w, h: b.h, confidence: b.similarity } },
        message: `Image appeared at (${b.cx}, ${b.cy}) similarity=${b.similarity}`,
      };
    }
    lastError = found.error || 'not found';
    await new Promise(r => setTimeout(r, poll));
  }
  return { ok: false, error: `Image not found within ${timeout}ms (last: ${lastError})` };
}
