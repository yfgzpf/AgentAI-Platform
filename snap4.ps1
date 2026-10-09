Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

$proc = Get-Process -Name "agentai-desktop" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host "[!] no Tauri"; exit 1 }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class W {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    public static IntPtr FindByPid(uint pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().Contains("PulseFlow")) { result = h; return false; } } return true; }, IntPtr.Zero);
        return result;
    }
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(80);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(60);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    }
}
'@ -ErrorAction SilentlyContinue

$hwnd = [W]::FindByPid([uint32]$proc.Id)
[void][W]::ShowWindow($hwnd, 3)
Start-Sleep -Seconds 1
[void][W]::SetForegroundWindow($hwnd)
Start-Sleep -Seconds 1
[W+RECT]$r = New-Object W+RECT
[void][W]::GetWindowRect($hwnd, [ref]$r)

# 截图原始窗口
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
function Take-Screenshot($name) {
    param([string]$name)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
    $out = "F:\temp\$name"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $info = Get-Item $out
    Write-Host "[$name] $([math]::Round($info.Length/1KB, 1)) KB"
}

# 创作 tab 在 top nav 大约 x=480, y=42 (基于 1936x1056 视口)
# 估算偏移: 1920 屏幕用 1936 视口
# Top nav Y ≈ 36
# 创作 tab X: 100(brand) + 40(chat) + 50(editor) + 50(医案) + 50(浏览器) ≈ 290
Write-Host "Click on '创作' nav (approximate x=380, y=36)"
[W]::Click(380, 36)
Start-Sleep -Seconds 1
Take-Screenshot "desktop-12-media-dropdown.png"
