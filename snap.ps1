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
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    public static IntPtr FindByPid(uint pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { var sb = new System.Text.StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().Contains("PulseFlow")) { result = h; return false; } } return true; }, IntPtr.Zero);
        return result;
    }
}
'@ -ErrorAction SilentlyContinue

$proc = Get-Process -Name "agentai-desktop" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host "[!] no Tauri"; exit 1 }
$hwnd = [W]::FindByPid([uint32]$proc.Id)
Write-Host "Tauri hWnd: $hwnd"
if ($hwnd -eq [IntPtr]::Zero) { exit 1 }
[void][W]::ShowWindow($hwnd, 3)
Start-Sleep -Seconds 2
[void][W]::SetForegroundWindow($hwnd)
Start-Sleep -Seconds 2
[W+RECT]$r = New-Object W+RECT
[void][W]::GetWindowRect($hwnd, [ref]$r)
Write-Host "Window: ($($r.Left),$($r.Top)) - ($($r.Right),$($r.Bottom))"

# Screenshot of just the window region
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
$out = "F:\temp\desktop-09-tauri-only.png"
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$info = Get-Item $out
Write-Host "[OK] $($info.Name) - $([math]::Round($info.Length/1KB, 1)) KB - $($info.LastWriteTime.ToString('HH:mm:ss'))"
