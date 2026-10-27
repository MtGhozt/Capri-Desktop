# Finds an app's processes and, asked to, closes their windows the way their own close button
# does (WM_CLOSE to each visible top-level window they own), then waits for them to go.
# Prints one JSON line: { "ids": [...], "names": [...], "left": n, "rect": {x,y,w,h} | null }.
# `rect`: its biggest visible window before anything was closed, in physical screen pixels
# (for her zap, Paso 4E).
#
# What the app is, any of:
#   -Names Discord,Update   processes by exe name
#   -Dir "C:\Games\X"       processes running from that folder (installed games)
#   -Title "Hollow Knight"  the processes owning a window titled that (or "that: ..." / "that - ...")
#
#   powershell -File close-app.ps1 [-Names a,b] [-Dir path] [-Title text] -Skip 123,456 -Mode probe|graceful [-WaitMs 4000]
#   powershell -File close-app.ps1 -Mode explorer-probe|explorer
#     File Explorer windows only (counted in "left"), closed through the shell; explorer.exe stays.

param(
  [string]$Names = '', [string]$Dir = '', [string]$Title = '', [string]$Skip = '',
  [string]$Mode = 'probe', [int]$WaitMs = 4000
)
$ErrorActionPreference = 'SilentlyContinue'

$skipIds = @($Skip -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
$wanted = @($Names -split ',' | Where-Object { $_ -match '^[\w .+()-]+$' })
$folder = $Dir.Trim().TrimEnd('\')
if ($folder -and -not ($folder -match '^[a-zA-Z]:\\.+')) { $folder = '' }
$Title = $Title.Trim()
# a window title is never enough for her own windows, the browser's or Windows' own
$titleSkip = @('capri', 'electron', 'explorer', 'opera', 'chrome', 'msedge', 'firefox', 'brave', 'vivaldi', 'dwm', 'applicationframehost', 'textinputhost')

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriClose {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  const uint WM_CLOSE = 0x0010;
  const uint GW_OWNER = 4;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  static int[] RectOf(IntPtr hwnd) {
    if (IsIconic(hwnd)) return null;
    RECT r;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0 && !GetWindowRect(hwnd, out r)) return null;
    int w = r.Right - r.Left, h = r.Bottom - r.Top;
    if (w < 40 || h < 30) return null;
    return new[] { r.Left, r.Top, w, h };
  }

  // the biggest visible top-level window of these pids: [x, y, w, h], or null
  public static int[] Biggest(int[] ids) {
    var wanted = new HashSet<uint>();
    foreach (var id in ids) wanted.Add((uint)id);
    int[] best = null;
    EnumWindows((hwnd, l) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (wanted.Contains(pid) && TopLevel(hwnd)) {
        var r = RectOf(hwnd);
        if (r != null && (best == null || (long)r[2] * r[3] > (long)best[2] * best[3])) best = r;
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  public static int[] Window(long hwnd) {
    return hwnd == 0 ? null : RectOf(new IntPtr(hwnd));
  }

  static bool TopLevel(IntPtr hwnd) {
    return IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == IntPtr.Zero;
  }

  public static int Close(int[] ids) {
    var wanted = new HashSet<uint>();
    foreach (var id in ids) wanted.Add((uint)id);
    int sent = 0;
    EnumWindows((hwnd, l) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (wanted.Contains(pid) && TopLevel(hwnd)) {
        if (PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) sent++;
      }
      return true;
    }, IntPtr.Zero);
    return sent;
  }

  // pids owning a visible top-level window titled `title`, or "title: ...", "title - ...", "title | ..."
  public static int[] ByTitle(string title) {
    var found = new HashSet<int>();
    var cmp = StringComparison.OrdinalIgnoreCase;
    EnumWindows((hwnd, l) => {
      if (!TopLevel(hwnd)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(hwnd, sb, sb.Capacity);
      var text = sb.ToString().Trim();
      bool match = text.Equals(title, cmp);
      if (!match && text.StartsWith(title, cmp) && text.Length > title.Length) {
        char next = text[title.Length];
        match = next == ':' || ((next == ' ') && text.Substring(title.Length).TrimStart().IndexOfAny(new[] { '-', '|', ':', '\u2013', '\u2014' }) == 0);
      }
      if (match) {
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        found.Add((int)pid);
      }
      return true;
    }, IntPtr.Zero);
    var list = new List<int>(found);
    return list.ToArray();
  }
}
"@
[CapriClose]::Init()

function Rect-Json($r) {
  if (-not $r) { return $null }
  [pscustomobject]@{ x = $r[0]; y = $r[1]; w = $r[2]; h = $r[3] }
}

if ($Mode -like 'explorer*') {
  $shellApp = New-Object -ComObject Shell.Application
  $folders = { @($shellApp.Windows() | Where-Object { $_.FullName -match '\\explorer\.exe$' }) }
  $wins = @(& $folders)
  $rect = $null
  foreach ($w in $wins) {
    $r = [CapriClose]::Window([long]$w.HWND)
    if ($r -and (-not $rect -or $r[2] * $r[3] -gt $rect[2] * $rect[3])) { $rect = $r }
  }
  if ($Mode -eq 'explorer') {
    foreach ($w in $wins) { $w.Quit() }
    $deadline = (Get-Date).AddMilliseconds([Math]::Min($WaitMs, 2000))
    do { Start-Sleep -Milliseconds 200; $wins = @(& $folders) } while ($wins.Count -gt 0 -and (Get-Date) -lt $deadline)
  }
  [pscustomobject]@{ ids = @(); names = @(); left = $wins.Count; rect = (Rect-Json $rect) } | ConvertTo-Json -Compress
  exit 0
}


function Find-Procs {
  $procs = @()
  if ($wanted.Count) { $procs += @(Get-Process -Name $wanted -ErrorAction SilentlyContinue) }
  if ($folder) {
    $prefix = $folder + '\'
    $procs += @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
  }
  if ($Title) {
    $byTitle = @([CapriClose]::ByTitle($Title))
    if ($byTitle.Count) {
      $procs += @(Get-Process -Id $byTitle -ErrorAction SilentlyContinue | Where-Object { $titleSkip -notcontains $_.ProcessName.ToLower() })
    }
  }
  @($procs | Where-Object { $_ -and ($skipIds -notcontains $_.Id) } | Sort-Object Id -Unique)
}

$procs = @(Find-Procs)
$ids = @($procs | ForEach-Object { $_.Id })
$names = @($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
$left = $ids.Count
$rect = $null
if ($ids.Count) { $rect = [CapriClose]::Biggest([int[]]$ids) }

if ($Mode -eq 'graceful' -and $ids.Count) {
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

[pscustomobject]@{ ids = @($ids); names = @($names); left = $left; rect = (Rect-Json $rect) } | ConvertTo-Json -Compress
