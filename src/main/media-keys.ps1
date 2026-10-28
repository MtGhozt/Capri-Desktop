param([Parameter(Mandatory=$true)][ValidateSet('play','pause','next','previous','volumeUp','volumeDown','mute')][string]$Action)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CapriMedia {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
}
'@
$keys = @{ play=0xB3; pause=0xB3; next=0xB0; previous=0xB1; volumeUp=0xAF; volumeDown=0xAE; mute=0xAD }
$key = [byte]$keys[$Action]
$scan = [byte][CapriMedia]::MapVirtualKey($key, 0)
[CapriMedia]::keybd_event($key, $scan, 1, [UIntPtr]::Zero)
[CapriMedia]::keybd_event($key, $scan, 3, [UIntPtr]::Zero)
