/**
 * window-control: 窗口控制（Windows 优先 + 跨平台占位）
 * ----------------------------------------------------
 * 用途: AI 助手可枚举/最小化/置顶/移动/调整窗口
 * 安全守护:
 *  - 标题黑名单（系统窗口、密码管理器）
 *  - 跨平台: Windows 全功能, macOS 限 list/focus, Linux 占位
 */
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const BLACKLIST_TITLE = [
  /Credential\s*Manager/i, /凭据管理器/,
  /1Password/i, /Bitwarden/i, /KeePass/i, /LastPass/i,
  /Windows\s*Security/i, /Windows 安全中心/,
  /Task\s*Manager/i, /任务管理器/,
];

export interface WindowInfo {
  hwnd: string;
  title: string;
  process: string;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export type WindowAction = 'minimize' | 'maximize' | 'restore' | 'close' | 'show' | 'hide' | 'focus' | 'move' | 'resize';

export interface WindowControlOptions {
  action: WindowAction;
  windowTitle?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WindowControlResult {
  ok: boolean;
  message: string;
  error?: string;
}

/** ===== 列出所有可见窗口 ===== */
export async function listWindows(titleFilter?: string): Promise<WindowInfo[]> {
  if (process.platform !== 'win32') return [];
  const script = buildListWindowsScript(titleFilter || '');
  const output = await runPowerShell(script);
  try {
    const lines = output.split('\n').filter(l => l.trim());
    return lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((w): w is WindowInfo => w !== null);
  } catch {
    return [];
  }
}

function buildListWindowsScript(filter: string): string {
  const safeFilter = filter.replace(/'/g, "''");
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
$results = @()
$callback = [W+EnumWindowsProc]{
  param($hwnd, $lParam)
  if ([W]::IsWindowVisible($hwnd)) {
    $len = [W]::GetWindowTextLength($hwnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [W]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      $title = $sb.ToString()
      if ('${safeFilter}' -eq '' -or $title -like '*${safeFilter}*') {
        $pid = 0
        [W]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        $proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName
        $rect = New-Object W+RECT
        [W]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
        $obj = @{ hwnd = $hwnd.ToInt64(); title = $title; process = $proc; rect = @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }; visible = $true }
        $json = $obj | ConvertTo-Json -Compress
        Write-Output $json
      }
    }
  }
  return $true
}
[W]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
`;
}

/** ===== 窗口控制 ===== */
export async function windowControl(opts: WindowControlOptions): Promise<WindowControlResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: '', error: 'Window control only on Windows' };
  }
  // 1. 黑名单
  const windowTitle = opts.windowTitle || '';
  if (windowTitle && BLACKLIST_TITLE.some(p => p.test(windowTitle))) {
    return { ok: false, message: '', error: 'Window title blocked by safety policy' };
  }
  // 2. 找 hwnd（通过标题）
  if (!['list'].includes(opts.action) && !windowTitle) {
    return { ok: false, message: '', error: 'windowTitle required for non-list actions' };
  }
  const script = buildControlScript({ ...opts, windowTitle });
  try {
    const output = await runPowerShell(script);
    return { ok: true, message: `${opts.action} 完成: ${output.trim()}` };
  } catch (e: any) {
    return { ok: false, message: '', error: e.message };
  }
}

function buildControlScript(opts: WindowControlOptions & { windowTitle: string }): string {
  const safeTitle = opts.windowTitle.replace(/'/g, "''");
  let actionLine = '';
  switch (opts.action) {
    case 'minimize': actionLine = `$code = 0xF020`; break; // SC_MINIMIZE
    case 'maximize': actionLine = `$code = 0xF030`; break; // SC_MAXIMIZE
    case 'restore': actionLine = `$code = 0xF120`; break;  // SC_RESTORE
    case 'close': actionLine = `$code = 0xF060`; break;    // SC_CLOSE
    case 'move':
      actionLine = `[Win]::SetWindowPos($hwnd, [IntPtr]::Zero, ${opts.x || 0}, ${opts.y || 0}, 0, 0, 0x0040)`;
      break;
    case 'resize':
      actionLine = `[Win]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, ${opts.width || 800}, ${opts.height || 600}, 0x0040)`;
      break;
    case 'focus':
    case 'show':
    case 'hide':
      const cmd = opts.action === 'hide' ? 'Hide' : 'Show';
      actionLine = `(Get-Process | Where-Object { $_.MainWindowTitle -like '*${safeTitle}*' } | Select-Object -First 1).MainWindowHandle | ForEach-Object { Add-Type -TypeDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);' -ErrorAction SilentlyContinue; [User32]::ShowWindow($_, ${opts.action === 'focus' ? 5 : (opts.action === 'hide' ? 0 : 1)}) }`;
      break;
  }
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safeTitle}*' } | Select-Object -First 1
if (-not $proc) { Write-Output "Not found"; exit 1 }
$hwnd = $proc.MainWindowHandle
${opts.action === 'focus' || opts.action === 'show' || opts.action === 'hide' ? actionLine : `[Win]::SendMessage($hwnd, 0x0112, [IntPtr]::Zero, [IntPtr]$code)`}
Write-Output "OK"
`;
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `wc_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', tmpFile], { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
