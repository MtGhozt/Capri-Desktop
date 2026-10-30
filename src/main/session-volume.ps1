# Per-process session volume only (Spotify / Namida). Never touches master volume.
# Uses raw COM vtable calls — RCW casts for IAudioSessionEnumerator are unreliable here.
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('volumeUp', 'volumeDown', 'mute', 'unmute')]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$ProcessNames
)

$ErrorActionPreference = 'Stop'
$names = @($ProcessNames.Split(',') | ForEach-Object {
  $n = $_.Trim()
  if (-not $n) { return }
  $n
  [IO.Path]::GetFileNameWithoutExtension($n)
} | Select-Object -Unique)
if (-not $names.Count) { Write-Output 'NONE'; exit 2 }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class CapriSessionVol {
  const int CLSCTX_ALL = 23;

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr endpoint);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetSessionEnumerator(IntPtr self, out IntPtr sessionEnum);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetCount(IntPtr self, out int count);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetSession(IntPtr self, int index, out IntPtr session);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetProcessId(IntPtr self, out uint pid);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetMasterVolume(IntPtr self, out float level);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnSetMasterVolume(IntPtr self, float level, ref Guid ctx);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnGetMute(IntPtr self, out bool muted);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnSetMute(IntPtr self, bool muted, ref Guid ctx);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int FnQueryInterface(IntPtr self, ref Guid iid, out IntPtr ppv);

  static IntPtr V(IntPtr obj, int slot) {
    return Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj), IntPtr.Size * slot);
  }

  static T Del<T>(IntPtr obj, int slot) where T : class {
    return Marshal.GetDelegateForFunctionPointer<T>(V(obj, slot));
  }

  public static int Adjust(string[] processNames, string action, float step) {
    var want = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var n in processNames) if (!string.IsNullOrWhiteSpace(n)) want.Add(n.Trim());

    var enumerator = (IMMDeviceEnumerator)(object)new MMDeviceEnumeratorComObject();
    IntPtr pDevice;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out pDevice));
    try {
      var device = (IMMDevice)Marshal.GetObjectForIUnknown(pDevice);
      var iidMgr = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
      object oMgr;
      Marshal.ThrowExceptionForHR(device.Activate(ref iidMgr, CLSCTX_ALL, IntPtr.Zero, out oMgr));
      IntPtr pUnk = Marshal.GetIUnknownForObject(oMgr);
      IntPtr pMgr;
      Marshal.ThrowExceptionForHR(Marshal.QueryInterface(pUnk, ref iidMgr, out pMgr));
      Marshal.Release(pUnk);
      try {
        // IAudioSessionManager2: slot 5 = GetSessionEnumerator
        IntPtr pEnum;
        Marshal.ThrowExceptionForHR(Del<FnGetSessionEnumerator>(pMgr, 5)(pMgr, out pEnum));
        try {
          // IAudioSessionEnumerator: slot 3 = GetCount, 4 = GetSession
          int count;
          Marshal.ThrowExceptionForHR(Del<FnGetCount>(pEnum, 3)(pEnum, out count));
          int hit = 0;
          var ctx = Guid.Empty;
          var iidCtl2 = new Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D");
          var iidVol = new Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8");
          for (int i = 0; i < count; i++) {
            IntPtr pSess;
            if (Del<FnGetSession>(pEnum, 4)(pEnum, i, out pSess) != 0 || pSess == IntPtr.Zero) continue;
            try {
              IntPtr pCtl2;
              if (Del<FnQueryInterface>(pSess, 0)(pSess, ref iidCtl2, out pCtl2) != 0) continue;
              try {
                IntPtr pVol;
                if (Del<FnQueryInterface>(pSess, 0)(pSess, ref iidVol, out pVol) != 0) continue;
                try {
                  uint pid;
                  if (Del<FnGetProcessId>(pCtl2, 14)(pCtl2, out pid) != 0 || pid == 0) continue;
                  string pname;
                  try { pname = Process.GetProcessById((int)pid).ProcessName; }
                  catch { continue; }
                  if (!want.Contains(pname)) continue;
                  hit++;
                  if (action == "mute") { Del<FnSetMute>(pVol, 5)(pVol, true, ref ctx); continue; }
                  if (action == "unmute") { Del<FnSetMute>(pVol, 5)(pVol, false, ref ctx); continue; }
                  float level;
                  Del<FnGetMasterVolume>(pVol, 4)(pVol, out level);
                  bool muted;
                  Del<FnGetMute>(pVol, 6)(pVol, out muted);
                  if (muted) Del<FnSetMute>(pVol, 5)(pVol, false, ref ctx);
                  float next = action == "volumeUp" ? level + step : level - step;
                  if (next < 0f) next = 0f;
                  if (next > 1f) next = 1f;
                  Del<FnSetMasterVolume>(pVol, 3)(pVol, next, ref ctx);
                } finally { Marshal.Release(pVol); }
              } finally { Marshal.Release(pCtl2); }
            } finally { Marshal.Release(pSess); }
          }
          return hit;
        } finally { Marshal.Release(pEnum); }
      } finally { Marshal.Release(pMgr); }
    } finally { Marshal.Release(pDevice); }
  }
}
'@

$hit = [CapriSessionVol]::Adjust([string[]]$names, $Action, 0.1)
if ($hit -lt 1) { Write-Output 'NONE'; exit 1 }
Write-Output "OK $hit"
exit 0
