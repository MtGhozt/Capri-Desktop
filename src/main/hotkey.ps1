# Sends a key combo to Windows (e.g. -Key F10 -Mods Alt), for NVIDIA's Instant Replay.
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Mods = ''
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CapriKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$VK = @{ Control = 0x11; Alt = 0x12; Shift = 0x10; Super = 0x5B }
$VK_KEY = @{
  PrintScreen = 0x2C; Insert = 0x2D; Delete = 0x2E; Home = 0x24; End = 0x23
  PageUp = 0x21; PageDown = 0x22; Pause = 0x13; ScrollLock = 0x91; Space = 0x20; Tab = 0x09
}
for ($i = 1; $i -le 24; $i++) { $VK_KEY["F$i"] = 0x6F + $i }
for ($c = 65; $c -le 90; $c++) { $VK_KEY[[string][char]$c] = $c }
for ($d = 0; $d -le 9; $d++) { $VK_KEY["$d"] = 0x30 + $d }

$code = $VK_KEY[$Key]
if ($null -eq $code) { throw "unknown key: $Key" }

$held = @()
foreach ($mod in @($Mods -split ',' | Where-Object { $_ })) {
  # note: $vk would clash with $VK (PowerShell is case-insensitive) and wipe the table
  $modVk = $VK[$mod]
  if ($null -eq $modVk) { throw "unknown modifier: $mod" }
  [CapriKeys]::keybd_event([byte]$modVk, 0, 0, [UIntPtr]::Zero)
  $held += $modVk
}
Start-Sleep -Milliseconds 30
[CapriKeys]::keybd_event([byte]$code, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[CapriKeys]::keybd_event([byte]$code, 0, 2, [UIntPtr]::Zero)
foreach ($modVk in $held) {
  Start-Sleep -Milliseconds 20
  [CapriKeys]::keybd_event([byte]$modVk, 0, 2, [UIntPtr]::Zero)
}
