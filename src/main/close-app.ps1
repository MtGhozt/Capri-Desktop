# Finds an app's processes by name and, asked to, closes their windows the way their own close
# button does (WM_CLOSE to each visible top-level window they own), then waits for them to go.
# Prints one JSON line: { "ids": [...], "left": n }.
#
#   powershell -File close-app.ps1 -Names Discord,Update -Skip 123,456 -Mode probe|graceful [-WaitMs 4000]

param([string]$Names = '', [string]$Skip = '', [string]$Mode = 'probe', [int]$WaitMs = 4000)
$ErrorActionPreference = 'SilentlyContinue'

$skipIds = @($Skip -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
$wanted = @($Names -split ',' | Where-Object { $_ -match '^[\w .+()-]+$' })
if (-not $wanted.Count) { '{"ids":[],"left":0}'; exit 0 }

function Find-Ids {
  @(Get-Process -Name $wanted -ErrorAction SilentlyContinue |
    Where-Object { $skipIds -notcontains $_.Id } |
    ForEach-Object { $_.Id })
}

$ids = @(Find-Ids)
$left = $ids.Count

if ($Mode -eq 'graceful' -and $ids.Count) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CapriClose {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  const uint WM_CLOSE = 0x0010;
  const uint GW_OWNER = 4;

  public static int Close(int[] ids) {
    var wanted = new HashSet<uint>();
    foreach (var id in ids) wanted.Add((uint)id);
    int sent = 0;
    EnumWindows((hwnd, l) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (wanted.Contains(pid) && IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == IntPtr.Zero) {
        if (PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) sent++;
      }
      return true;
    }, IntPtr.Zero);
    return sent;
  }
}
"@
  $sent = [CapriClose]::Close([int[]]$ids)
  if ($sent -eq 0) {
    # no visible window of its own: its main window, if it has one
    foreach ($p in @(Get-Process -Id $ids -ErrorAction SilentlyContinue)) { [void]$p.CloseMainWindow() }
  }
  $deadline = (Get-Date).AddMilliseconds($WaitMs)
  do {
    Start-Sleep -Milliseconds 250
    $left = @(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count
  } while ($left -gt 0 -and (Get-Date) -lt $deadline)
}

[pscustomobject]@{ ids = @($ids); left = $left } | ConvertTo-Json -Compress
