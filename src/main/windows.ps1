# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window (its exe, its title
# and whether it covers its monitor) and the visible windows in z-order (front first), as
# physical-pixel frame bounds. Only the foreground title is read, never the other windows'.
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid> [-Once]

param([long]$Self = 0, [int]$ParentPid = 0, [switch]$Once)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const uint MONITOR_DEFAULTTONEAREST = 2;

  static readonly Dictionary<long, string> ExeCache = new Dictionary<long, string>();

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  static string Quote(string s) {
    if (String.IsNullOrEmpty(s)) return "\"\"";
    return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }

  // Full path of the process that owns the window (game mode needs it); cached, since
  // Snapshot runs every 150 ms.
  static string ExeOf(long hwnd) {
    string cached;
    if (ExeCache.TryGetValue(hwnd, out cached)) return cached;
    string path = "";
    uint pid;
    GetWindowThreadProcessId(new IntPtr(hwnd), out pid);
    if (pid != 0) {
      IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (handle != IntPtr.Zero) {
        var sb = new StringBuilder(1024);
        uint size = 1024;
        if (QueryFullProcessImageName(handle, 0, sb, ref size)) path = sb.ToString();
        CloseHandle(handle);
      }
    }
    if (ExeCache.Count > 128) ExeCache.Clear();
    ExeCache[hwnd] = path;
    return path;
  }

  // Edge to edge on its monitor: borderless or exclusive fullscreen. A maximized window
  // leaves the taskbar out, so it does not count.
  static bool Fullscreen(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    RECT r;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0
        && !GetWindowRect(hwnd, out r)) return false;
    IntPtr monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    var info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(monitor, ref info)) return false;
    RECT m = info.rcMonitor;
    return Math.Abs(r.Left - m.Left) <= 2 && Math.Abs(r.Top - m.Top) <= 2
        && Math.Abs(r.Right - m.Right) <= 2 && Math.Abs(r.Bottom - m.Bottom) <= 2;
  }

  // Title of the foreground window only (a browser tab says YouTube or Netflix). Capri never
  // stores it: it is looked at to pick a line and thrown away with the snapshot.
  static string TitleOf(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return "";
    var sb = new StringBuilder(256);
    GetWindowText(hwnd, sb, sb.Capacity);
    string title = sb.ToString();
    return title.Length > 200 ? title.Substring(0, 200) : title;
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr fg = GetForegroundWindow();
    var fgClass = new StringBuilder(64);
    GetClassName(fg, fgClass, 64);
    // the taskbar clicked: it comes up over her (Windows has no levels among windows on top)
    bool taskbar = fgClass.ToString() == "Shell_TrayWnd" || fgClass.ToString() == "Shell_SecondaryTrayWnd";
    sb.Append("{\"fg\":").Append(fg.ToInt64())
      .Append(",\"fgExe\":").Append(Quote(fg == IntPtr.Zero ? "" : ExeOf(fg.ToInt64())))
      .Append(",\"fgTitle\":").Append(Quote(TitleOf(fg)))
      .Append(",\"fgFull\":").Append(Fullscreen(fg) ? "true" : "false")
      .Append(",\"taskbar\":").Append(taskbar ? "true" : "false").Append(",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
if ($Once) {
  [Console]::Out.WriteLine([CapriWindows]::Snapshot($Self))
  exit 0
}
$last = ''
$tick = 0
while ($true) {
  $snap = [CapriWindows]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 150
}
