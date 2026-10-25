# Restore focus to a window we stole it from when the chat overlay closed.
param([long]$Hwnd)
$ErrorActionPreference = 'Stop'
if ($Hwnd -eq 0) { exit 0 }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CapriFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$h = [IntPtr]$Hwnd
if (-not [CapriFocus]::IsWindow($h)) { exit 0 }
$pid = [uint32]0
[void][CapriFocus]::GetWindowThreadProcessId($h, [ref]$pid)
if ($pid -ne 0) {
  try { (New-Object -ComObject WScript.Shell).AppActivate([int]$pid) | Out-Null } catch {}
}
[void][CapriFocus]::ShowWindow($h, 5) # SW_SHOW, don't restore a minimized window's size dance
[void][CapriFocus]::BringWindowToTop($h)
[void][CapriFocus]::SetForegroundWindow($h)
