param([Parameter(Mandatory=$true)][ValidateSet('play','pause','next','previous','volumeUp','volumeDown','mute')][string]$Action)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CapriMedia {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$keys = @{ play=0xB3; pause=0xB3; next=0xB0; previous=0xB1; volumeUp=0xAF; volumeDown=0xAE; mute=0xAD }
$key = [byte]$keys[$Action]
[CapriMedia]::keybd_event($key, 0, 0, [UIntPtr]::Zero)
[CapriMedia]::keybd_event($key, 0, 2, [UIntPtr]::Zero)
