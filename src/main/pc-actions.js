'use strict';

// Closed-list PC actions for reply tags ([volume:…], [settings:…], [theme:…], [pc:snip],
// [window:…]) and system-info facts for the LLM (battery / disk / RAM / IP → turnExtras).
// Windows only; allowlist only — never runs arbitrary LLM text as a command.

const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { processName } = require('./apps-config');

const TIMEOUT_MS = 8000;

// page key → ms-settings: URI suffix
const SETTINGS = {
  bluetooth: 'bluetooth',
  sound: 'sound',
  display: 'display',
  wifi: 'network-wifi',
  network: 'network-status',
  notifications: 'notifications',
  apps: 'appsfeatures',
  update: 'windowsupdate',
};

const SETTINGS_PAGES = Object.keys(SETTINGS);
const VOLUME_WORDS = ['up', 'down', 'mute', 'unmute'];
const THEME_VALUES = ['dark', 'light'];
const INFO_KINDS = ['battery', 'disk', 'ram', 'ip'];
const WINDOW_POSITIONS = ['left', 'right', 'max', 'min', 'restore'];
// Process names may include a single inner space ("Grok Bot"); no quotes/$/`/newlines.
const PROC_OK = /^[A-Za-z0-9._-]+( [A-Za-z0-9._-]+)*$/;
const CAPRI_PROC = /^(?:capri(?:-desktop)?|electron)$/i;
const FIND_TIMEOUT_MS = 4000;
const FIND_SCAN_MAX = 200;
const FIND_TOP = 5;
const FILE_KINDS = ['pdf', 'word', 'excel', 'ppt', 'image', 'video', 'audio', 'zip', 'any'];
const FILE_EXTS = {
  pdf: ['.pdf'],
  word: ['.doc', '.docx', '.odt', '.rtf'],
  excel: ['.xls', '.xlsx', '.csv', '.ods'],
  ppt: ['.ppt', '.pptx', '.odp'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.svg'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv'],
  audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'],
  zip: ['.zip', '.rar', '.7z', '.tar', '.gz'],
  any: [],
};
const FILE_KIND_ALIAS = {
  pdf: 'pdf',
  word: 'word', doc: 'word', documento: 'word', documentos: 'word',
  excel: 'excel', xls: 'excel', xlsx: 'excel', hoja: 'excel', planilla: 'excel',
  ppt: 'ppt', powerpoint: 'ppt', presentacion: 'ppt', presentaciones: 'ppt',
  image: 'image', imagen: 'image', imagenes: 'image', foto: 'image', fotos: 'image', picture: 'image',
  video: 'video', videos: 'video',
  audio: 'audio', mp3: 'audio', wav: 'audio',
  zip: 'zip', rar: 'zip', comprimido: 'zip',
  archivo: 'any', archivos: 'any', file: 'any', fichero: 'any',
};
const FILE_PICK = { primero: 1, segundo: 2, tercero: 3, cuarto: 4, quinto: 5 };
/** Last findFiles hits for "abrí el segundo" (memory only). */
let lastFileHits = [];

const AUDIO = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid context);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
  int GetMute(out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, int p, out IAudioEndpointVolume volume); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator { }
public static class CapriAudio {
  static IAudioEndpointVolume Volume() {
    IMMDevice device;
    Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)new DeviceEnumerator()).GetDefaultAudioEndpoint(0, 1, out device));
    IAudioEndpointVolume volume;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, 0, out volume));
    return volume;
  }
  public static int Level { get { float v; Marshal.ThrowExceptionForHR(Volume().GetMasterVolumeLevelScalar(out v)); return (int)Math.Round(v * 100); } }
  public static void Set(int level) { Marshal.ThrowExceptionForHR(Volume().SetMasterVolumeLevelScalar(level / 100f, Guid.Empty)); }
  public static void Mute(bool mute) { Marshal.ThrowExceptionForHR(Volume().SetMute(mute, Guid.Empty)); }
}
"@
`;

function powershell(command, { execFileImpl = execFile, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout, encoding: 'utf8' },
      (err, out) => (err ? reject(err) : resolve(String(out || '').trim())),
    );
  });
}

function fail(line) {
  return { ok: false, line: line || 'No pude hacer eso en la PC.' };
}

function parseVolumeValue(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (VOLUME_WORDS.includes(text)) return text;
  const n = Number(String(text).replace(/%$/, ''));
  if (Number.isFinite(n) && n >= 0 && n <= 100) return String(Math.round(n));
  return null;
}

function parseSettingsValue(raw) {
  const page = String(raw || '').trim().toLowerCase();
  return SETTINGS[page] ? page : null;
}

function parseThemeValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return THEME_VALUES.includes(v) ? v : null;
}

function parseInfoValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return INFO_KINDS.includes(v) ? v : null;
}

function parseWindowPosition(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'left' || v === 'izquierda') return 'left';
  if (v === 'right' || v === 'derecha') return 'right';
  if (v === 'max' || v === 'maximize' || v === 'maximizar') return 'max';
  if (v === 'min' || v === 'minimize' || v === 'minimizar') return 'min';
  if (v === 'restore' || v === 'restaurar') return 'restore';
  return WINDOW_POSITIONS.includes(v) ? v : null;
}

/** Sanitize a process name for PowerShell: allowlisted charset only, no .exe. */
function sanitizeProcess(name) {
  const raw = String(name || '').replace(/\.exe$/i, '');
  // reject leading/trailing/double spaces (PROC_OK also forbids doubles)
  if (!raw || raw !== raw.trim() || / {2}/.test(raw)) return null;
  const n = raw.trim();
  return PROC_OK.test(n) && !CAPRI_PROC.test(n) ? n : null;
}

/** Tag value `Discord|left` → { app, position, value }. */
function parseWindowValue(raw) {
  const text = String(raw || '').trim();
  const bar = text.indexOf('|');
  if (bar < 0) return null;
  const app = text.slice(0, bar).trim();
  const position = parseWindowPosition(text.slice(bar + 1));
  if (!app || app.length > 64 || !/^[\w .+-]+$/u.test(app) || !position) return null;
  if (/^capri$/i.test(app)) return null;
  return { app, position, value: `${app}|${position}` };
}

function foldKey(text) {
  return String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function parseFileKind(raw) {
  const key = foldKey(raw).trim();
  if (FILE_KINDS.includes(key)) return key;
  return FILE_KIND_ALIAS[key] || null;
}

/** Sanitize search words: letters/digits only, capped. */
function sanitizeWords(words) {
  const list = Array.isArray(words) ? words : String(words || '').trim().split(/\s+/);
  const out = [];
  for (const w of list) {
    const t = String(w || '').trim();
    if (!t || t.length > 40) return null;
    if (!/^[\p{L}\p{N}._-]+$/u.test(t)) return null;
    out.push(t);
  }
  if (!out.length || out.length > 8) return null;
  return out;
}

/** Tag value `pdf|calculo` → { kind, words, value }. */
function parseFilesValue(raw) {
  const text = String(raw || '').trim();
  const bar = text.indexOf('|');
  if (bar < 0) return null;
  const kind = parseFileKind(text.slice(0, bar));
  const words = sanitizeWords(text.slice(bar + 1).trim().split(/\s+/).filter(Boolean));
  if (!kind || !words) return null;
  return { kind, words, value: `${kind}|${words.join(' ')}` };
}

function nameMatchesWords(fileName, words) {
  const n = foldKey(fileName);
  return (words || []).every((w) => n.includes(foldKey(w)));
}

function validateUserFilePath(p) {
  const path = require('node:path');
  const raw = String(p || '');
  if (!raw || raw.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)) return null;
  const n = path.win32.normalize(raw);
  if (!/^[A-Za-z]:\\/.test(n)) return null;
  return n;
}

/** PowerShell scan: only base64 config interpolated (ext list + caps). */
function buildFindCommand(exts) {
  const list = Array.isArray(exts) ? exts.map((e) => String(e).toLowerCase()).filter((e) => /^\.[a-z0-9]+$/.test(e)) : [];
  const payload = Buffer.from(JSON.stringify({ exts: list, max: FIND_SCAN_MAX }), 'utf8').toString('base64');
  if (!/^[A-Za-z0-9+/=]+$/.test(payload)) return null;
  return `$cfg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; `
    + '$exts = @($cfg.exts); $max = [int]$cfg.max; '
    + '$roots = @('
    + '[Environment]::GetFolderPath(\'Desktop\'),'
    + '[Environment]::GetFolderPath(\'MyDocuments\'),'
    + '[Environment]::GetFolderPath(\'MyPictures\'),'
    + '[Environment]::GetFolderPath(\'MyMusic\'),'
    + '[Environment]::GetFolderPath(\'MyVideos\'),'
    + '(Join-Path $env:USERPROFILE \'Downloads\')'
    + '); if ($env:OneDrive) { $roots += $env:OneDrive }; '
    + '$roots = $roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique; '
    + '$out = New-Object System.Collections.Generic.List[object]; $n = 0; '
    + 'foreach ($root in $roots) { if ($n -ge $max) { break }; '
    + 'Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { '
    + 'if ($n -ge $max) { return }; $n++; '
    + 'if ($exts.Count -gt 0 -and ($exts -notcontains $_.Extension.ToLowerInvariant())) { return }; '
    + '$out.Add([pscustomobject]@{ name = $_.Name; path = $_.FullName; dir = $_.DirectoryName; '
    + 'mtime = $_.LastWriteTimeUtc.ToString(\'o\') }) } }; '
    + 'if ($out.Count -eq 0) { \'[]\' } else { $out | ConvertTo-Json -Compress }';
}

/** True when `kind`/`value` is on the allowlist (parser + run share this). */
function allowed(kind, value) {
  const k = String(kind || '').toLowerCase();
  if (k === 'volume') return parseVolumeValue(value) != null;
  if (k === 'settings') return parseSettingsValue(value) != null;
  if (k === 'theme') return parseThemeValue(value) != null;
  if (k === 'info') return parseInfoValue(value) != null;
  if (k === 'snip' || (k === 'pc' && String(value || '').trim().toLowerCase() === 'snip')) return true;
  if (k === 'window') return parseWindowValue(value) != null;
  if (k === 'files') {
    if (/^pick\|[1-5]$/.test(String(value || ''))) return true;
    return parseFilesValue(value) != null;
  }
  return false;
}

async function setVolume(value, deps = {}) {
  const ps = deps.powershell || powershell;
  const word = parseVolumeValue(value);
  if (!word) return fail('Volumen desconocido.');
  let line = '';
  if (word === 'mute') line = '[CapriAudio]::Mute($true); ';
  else if (word === 'unmute') line = '[CapriAudio]::Mute($false); ';
  else if (word === 'up') line = '$n = [Math]::Min(100, [CapriAudio]::Level + 10); [CapriAudio]::Set($n); [CapriAudio]::Mute($false); ';
  else if (word === 'down') line = '$n = [Math]::Max(0, [CapriAudio]::Level - 10); [CapriAudio]::Set($n); [CapriAudio]::Mute($false); ';
  else line = `[CapriAudio]::Set(${word}); [CapriAudio]::Mute($false); `;
  try {
    const out = await ps(`${AUDIO}${line}[CapriAudio]::Level`);
    const level = Number.parseInt(out, 10);
    if (!Number.isFinite(level)) return fail('No pude cambiar el volumen.');
    return { ok: true, level };
  } catch {
    return fail('No pude cambiar el volumen.');
  }
}

async function openSettings(page, deps = {}) {
  const key = parseSettingsValue(page);
  if (!key) return fail('Esa página de Configuración no la tengo en la lista.');
  const open = deps.openExternal;
  if (typeof open !== 'function') return fail('No pude abrir Configuración.');
  try {
    await open(`ms-settings:${SETTINGS[key]}`);
    return { ok: true, page: key };
  } catch {
    return fail('No pude abrir Configuración.');
  }
}

async function setTheme(mode, deps = {}) {
  const theme = parseThemeValue(mode);
  if (!theme) return fail('Modo desconocido (dark o light).');
  const v = theme === 'dark' ? 0 : 1;
  const ps = deps.powershell || powershell;
  try {
    await ps(
      '$k = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"; '
      + `Set-ItemProperty -Path $k -Name AppsUseLightTheme -Value ${v} -Type DWord; `
      + `Set-ItemProperty -Path $k -Name SystemUsesLightTheme -Value ${v} -Type DWord; `
      + 'Add-Type -Namespace Capri -Name Msg -MemberDefinition \'[DllImport("user32.dll", CharSet = CharSet.Unicode)] '
      + 'public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r);\'; '
      + '$r = [UIntPtr]::Zero; [void][Capri.Msg]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "ImmersiveColorSet", 2, 3000, [ref]$r)',
    );
    return { ok: true, theme };
  } catch {
    return fail('No pude cambiar el tema claro/oscuro.');
  }
}

function formatBytes(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '?';
  const gb = x / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = x / (1024 ** 2);
  return `${Math.round(mb)} MB`;
}

const NO_BATTERY = 'Esta PC es de escritorio y no tiene batería: decilo claro en una frase, no inventes porcentaje.';

async function infoBattery(deps = {}) {
  const ps = deps.powershell || powershell;
  try {
    const out = await ps(
      'Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress',
    );
    if (!out || out === 'null' || out === '[]') return { line: NO_BATTERY };
    const b = JSON.parse(out);
    if (!b || typeof b !== 'object' || (Array.isArray(b) && !b.length)) return { line: NO_BATTERY };
    const row = Array.isArray(b) ? b[0] : b;
    if (!row || row.EstimatedChargeRemaining == null) return { line: NO_BATTERY };
    const pct = Number(row.EstimatedChargeRemaining);
    const charging = [2, 3, 6, 7, 8, 9].includes(Number(row.BatteryStatus));
    if (!Number.isFinite(pct)) return { line: 'No pude leer la batería.' };
    return { line: `Batería: ${Math.round(pct)}% (${charging ? 'cargando' : 'en batería'}).` };
  } catch {
    return { line: 'No pude leer la batería.' };
  }
}

async function infoDisk(deps = {}) {
  const ps = deps.powershell || powershell;
  try {
    const out = await ps(
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,FreeSpace,Size | ConvertTo-Json -Compress',
    );
    if (!out) return { line: 'No pude leer el disco.' };
    const rows = JSON.parse(out);
    const list = Array.isArray(rows) ? rows : [rows];
    const bits = list
      .map((d) => {
        const id = String(d.DeviceID || '').replace(/\\$/, '');
        const free = Number(d.FreeSpace);
        const total = Number(d.Size);
        if (!id || !Number.isFinite(free)) return null;
        return `${id} libre ${formatBytes(free)}${Number.isFinite(total) ? ` de ${formatBytes(total)}` : ''}`;
      })
      .filter(Boolean);
    if (!bits.length) return { line: 'No pude leer el disco.' };
    return { line: `Disco: ${bits.join('; ')}.` };
  } catch {
    // Node fallback: system drive only
    try {
      const drive = `${process.env.SystemDrive || 'C:'}\\`;
      const s = fs.statfsSync(drive);
      const free = s.bavail * s.bsize;
      const total = s.blocks * s.bsize;
      return { line: `Disco: ${drive.slice(0, 2)} libre ${formatBytes(free)} de ${formatBytes(total)}.` };
    } catch {
      return { line: 'No pude leer el disco.' };
    }
  }
}

function infoRam() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return { line: `RAM: ${formatBytes(used)} usados de ${formatBytes(total)}.` };
}

function infoIp() {
  const local = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/virtual|vethernet|vmware|loopback|vbox|wsl|hyper-v|docker/i.test(name))
    .flatMap(([, list]) => list || [])
    .find((a) => {
      const fam = a.family === 4 || a.family === 'IPv4';
      return fam && !a.internal && !String(a.address).startsWith('169.254.');
    });
  return { line: local?.address ? `IP local: ${local.address}.` : 'No encontré una IP local IPv4.' };
}

async function info(what, deps = {}) {
  const kind = parseInfoValue(what);
  if (!kind) return { line: 'No sé qué dato de la PC pediste.' };
  if (kind === 'battery') return infoBattery(deps);
  if (kind === 'disk') return infoDisk(deps);
  if (kind === 'ram') return infoRam();
  if (kind === 'ip') return infoIp();
  return { line: 'No sé qué dato de la PC pediste.' };
}

function detectInfoKinds(text) {
  const { normalizeCommandText } = require('./command-text');
  const said = normalizeCommandText(text);
  if (!said) return [];
  const out = [];
  if (/\b(bateria|battery|carga\s+de\s+la\s+bateria|cuanta\s+bateria|nivel\s+de\s+bateria)\b/.test(said)) {
    out.push('battery');
  }
  // "me gusta ese disco" stays with the model; need espacio/libre/almacenamiento/disco duro
  if (/\b(?:almacenamiento|disco\s+duro|disk\s+space|cuanto\s+espacio)\b/.test(said)
    || (/\bespacio\b/.test(said) && /\b(?:disco|almacenamiento)\b/.test(said))
    || (/\blibre\b/.test(said) && /\b(?:disco|almacenamiento|[c-z]:)\b/.test(said))) {
    out.push('disk');
  }
  // never when the phrase is about Capri's own memory footprint
  if (!/\bcapri\b/.test(said)
    && (/\bram\b/.test(said) || /\bcuanta\s+memoria\s+(?:tengo|queda|libre)\b/.test(said))) {
    out.push('ram');
  }
  if (/\b(ip\s+local|mi\s+ip|direccion\s+ip|cual\s+es\s+(?:mi\s+)?ip)\b/.test(said)) {
    out.push('ip');
  }
  return out;
}

/** Facts for this chat turn when the user asked about the PC (empty otherwise). */
async function contextSnippet(text, deps = {}) {
  const wants = detectInfoKinds(text);
  if (!wants.length) return '';
  const parts = [];
  for (const what of wants) {
    try {
      const got = await info(what, deps);
      if (got?.line) parts.push(got.line);
    } catch {
      parts.push(`No pude leer ${what}.`);
    }
  }
  if (!parts.length) return '';
  parts.push(
    'Usá solo estos datos de la PC; si no están, no inventes. Respondé en carácter (Capri) con esos hechos.',
    'En la respuesta visible escribí cantidades, tamaños e IPs con dígitos (el TTS los lee).',
  );
  return parts.join(' ');
}

const PLACE = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class CapriWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFO {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
  }
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO mi);
  public static bool Place(IntPtr h, string side) {
    ShowWindow(h, 9);
    var mon = MonitorFromWindow(h, 2);
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(mon, ref mi)) return false;
    int l = mi.rcWork.Left, t = mi.rcWork.Top;
    int w = mi.rcWork.Right - l, ht = mi.rcWork.Bottom - t;
    if (side == "left") return SetWindowPos(h, IntPtr.Zero, l, t, w/2, ht, 0x0040);
    if (side == "right") return SetWindowPos(h, IntPtr.Zero, l + w/2, t, w - w/2, ht, 0x0040);
    return false;
  }
}
"@
`;

/** PowerShell for one snap: process + position must already be allowlisted. */
function buildSnapCommand(process, position) {
  const proc = sanitizeProcess(process);
  const pos = parseWindowPosition(position);
  if (!proc || !pos) return null;
  const find = `$all = @(Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | `
    + 'Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }); '
    + 'if (-not $all.Count) { \'MISSING\' } else { '
    + '$fg = [CapriWin]::GetForegroundWindow(); '
    + '$p = $all | Where-Object { $_.MainWindowHandle -eq $fg } | Select-Object -First 1; '
    + 'if (-not $p) { $p = $all | Select-Object -First 1 }; ';
  if (pos === 'max') return `${PLACE}${find}[void][CapriWin]::ShowWindow($p.MainWindowHandle, 3); 'OK' }`;
  if (pos === 'min') return `${PLACE}${find}[void][CapriWin]::ShowWindow($p.MainWindowHandle, 6); 'OK' }`;
  if (pos === 'restore') return `${PLACE}${find}[void][CapriWin]::ShowWindow($p.MainWindowHandle, 9); 'OK' }`;
  return `${PLACE}${find}if ([CapriWin]::Place($p.MainWindowHandle, '${pos}')) { 'OK' } else { 'FAIL' } }`;
}

function resolveAppProcess(phrase, apps) {
  const { matchApp } = require('./app-command');
  const hit = matchApp(apps || [], phrase);
  if (hit.status !== 'sure' || !hit.app) return null;
  if (/^capri$/i.test(hit.app.name)) return null;
  const listed = hit.app.processes || [];
  // Explicit processes[]: never fall back to a truncated app-name candidate.
  if (listed.length) {
    for (const c of listed) {
      const safe = sanitizeProcess(c);
      if (safe) return { app: hit.app.name, process: safe };
    }
    return null;
  }
  for (const c of [processName(hit.app.target), processName(hit.app.name)]) {
    const safe = sanitizeProcess(c);
    if (safe) return { app: hit.app.name, process: safe };
  }
  return null;
}

function snapOkPhrase(result) {
  const name = result?.app || 'esa app';
  if (result?.position === 'left') return `${name} a la izquierda`;
  if (result?.position === 'right') return `${name} a la derecha`;
  if (result?.position === 'max') return `${name} maximizada`;
  if (result?.position === 'min') return `${name} minimizada`;
  if (result?.position === 'restore') return `${name} restaurada`;
  return name;
}

/** One spoken line after all snaps in a two-in-one (or single) arrange. */
function combineWindowResults(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return 'Listo.';
  if (list.length === 1) {
    const r = list[0];
    if (!r.ok) return r.line || `No pude mover la ventana de ${r.app || 'esa app'}.`;
    return `${snapOkPhrase(r)}.`;
  }
  const ok = list.filter((r) => r.ok);
  const bad = list.filter((r) => !r.ok);
  if (!bad.length) {
    const parts = list.map(snapOkPhrase);
    return parts.length === 2 ? `${parts[0]} y ${parts[1]}.` : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}.`;
  }
  if (ok.length) {
    const okPart = ok.map(snapOkPhrase).join(' y ');
    const badPart = bad.map((r) => String(r.line || '').replace(/\.$/, '')).filter(Boolean)
      .map((s, i) => (i === 0 ? s.replace(/^No /, 'no ') : s)).join('; ');
    return `${okPart}, pero ${badPart}.`;
  }
  return list.map((r) => r.line || `No pude mover la ventana de ${r.app || 'esa app'}.`).join(' ');
}

function windowAction(app, process, position) {
  const pos = parseWindowPosition(position);
  const proc = sanitizeProcess(process);
  if (!app || !pos || !proc) return null;
  return { kind: 'window', value: `${app}|${pos}`, app, process: proc, position: pos };
}

async function startSnip(deps = {}) {
  const open = deps.openExternal;
  if (typeof open !== 'function') return fail('No pude abrir el recorte.');
  try {
    await open('ms-screenclip:');
    return { ok: true };
  } catch {
    return fail('No pude abrir el recorte.');
  }
}

async function snapOne(snap, deps = {}) {
  const name = snap.app || 'esa app';
  const proc = sanitizeProcess(snap.process);
  const pos = parseWindowPosition(snap.position);
  if (!proc || !pos) return fail(`No pude mover la ventana de ${name}.`);
  const cmd = buildSnapCommand(proc, pos);
  if (!cmd) return fail(`No pude mover la ventana de ${name}.`);
  const ps = deps.powershell || powershell;
  try {
    const out = await ps(cmd);
    if (String(out || '').includes('MISSING')) return fail(`No veo ${name} abierta`);
    if (!String(out || '').includes('OK')) return fail(`No pude mover la ventana de ${name}.`);
    return { ok: true, app: name, process: proc, position: pos };
  } catch {
    return fail(`No pude mover la ventana de ${name}.`);
  }
}

async function snapWindows(action, deps = {}) {
  let snaps = Array.isArray(action?.snaps) ? action.snaps : null;
  if (!snaps) {
    let app = action?.app;
    let process = action?.process;
    let position = action?.position;
    if (!process || !position) {
      const parsed = parseWindowValue(action?.value);
      if (!parsed) return fail('Esa acción de ventana no está permitida.');
      app = app || parsed.app;
      position = position || parsed.position;
    }
    if (!process && app) {
      const hit = resolveAppProcess(app, deps.apps);
      if (!hit) return fail(`No veo ${app} abierta`);
      process = hit.process;
      app = hit.app;
    }
    const one = windowAction(app, process, position);
    if (!one) return fail('Esa acción de ventana no está permitida.');
    snaps = [one];
  }
  // Run every snap first; one combined reply (ok+ok / ok+fail), never speak mid-batch.
  const results = [];
  for (const snap of snaps) {
    const got = await snapOne(snap, deps);
    results.push({
      ...got,
      app: got.app || snap.app,
      position: got.position || snap.position,
      process: got.process || snap.process,
    });
  }
  const line = combineWindowResults(results);
  return { ok: results.every((r) => r.ok), line, results, snaps };
}

function formatFileHits(hits) {
  const path = require('node:path');
  return hits.map((h, i) => {
    const folder = path.win32.basename(h.dir || '') || h.dir || '?';
    let when = '?';
    try {
      when = new Date(h.mtime).toLocaleDateString('es-AR');
    } catch { /* keep ? */ }
    return `${i + 1}. ${h.name} — ${folder} — ${when}`;
  }).join('\n');
}

async function selectInExplorer(filePath, deps = {}) {
  const full = validateUserFilePath(filePath);
  if (!full) return fail('No pude abrir esa carpeta.');
  const run = deps.execFile || execFile;
  await new Promise((resolve) => {
    run('explorer.exe', [`/select,${full}`], { windowsHide: true }, () => resolve());
  });
  return { ok: true, path: full };
}

async function runFiles(action, deps = {}) {
  const value = String(action?.value || '').trim();
  const pickM = /^pick\|([1-5])$/.exec(value);
  if (pickM || action?.pick) {
    const n = Number(pickM ? pickM[1] : action.pick);
    const hit = lastFileHits[n - 1];
    if (!hit) return fail('No tengo una lista reciente; buscá de nuevo.');
    const sel = await selectInExplorer(hit.path, deps);
    if (!sel.ok) return sel;
    return { ok: true, line: `Ahí está: ${hit.name}`, pick: n, hit };
  }

  const parsed = parseFilesValue(value)
    || (action?.fileKind && action?.words
      ? { kind: action.fileKind, words: sanitizeWords(action.words), value }
      : null);
  if (!parsed?.kind || !parsed.words) return fail('Esa búsqueda de archivos no está permitida.');
  const exts = FILE_EXTS[parsed.kind];
  if (!exts) return fail('Esa búsqueda de archivos no está permitida.');
  const cmd = buildFindCommand(exts);
  if (!cmd) return fail('No pude buscar archivos.');
  const ps = deps.powershell || powershell;
  let rows = [];
  try {
    const out = await ps(cmd, { timeout: deps.findTimeoutMs || FIND_TIMEOUT_MS });
    const parsedJson = JSON.parse(out || '[]');
    rows = Array.isArray(parsedJson) ? parsedJson : (parsedJson ? [parsedJson] : []);
  } catch {
    return fail('No pude buscar archivos.');
  }
  const hits = rows
    .filter((r) => r && r.name && r.path && nameMatchesWords(r.name, parsed.words))
    .map((r) => ({
      name: String(r.name),
      path: String(r.path),
      dir: String(r.dir || ''),
      mtime: r.mtime || '',
    }))
    .filter((r) => validateUserFilePath(r.path))
    .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime) || 0)
    .slice(0, FIND_TOP);
  lastFileHits = hits;
  if (!hits.length) {
    return { ok: true, line: 'No encontré nada con eso en tus carpetas.', hits: [] };
  }
  if (hits.length === 1) {
    const sel = await selectInExplorer(hits[0].path, deps);
    if (!sel.ok) return { ok: false, line: `No pude abrir la carpeta de ${hits[0].name}.`, hits };
    return { ok: true, line: `Ahí está: ${hits[0].name}`, hits };
  }
  const line = `Encontré ${hits.length}:\n${formatFileHits(hits)}\nDecí «abrí el primero» (o segundo…) para abrir la carpeta.`;
  return { ok: true, line, hits };
}

function parseFindFilesCommand(said) {
  // music owns "buscá la canción…"; web search stays with the model
  if (/^(?:busca(?:me|r)?) (?:la |el )?(?:cancion|tema|rola|pista|musica)\b/.test(said)) return null;
  if (/\ben (?:google|bing|internet|la web|el navegador|youtube)\b/.test(said)) return null;

  const pick = /^abri(?:me|r)?(?: el)? (primero|segundo|tercero|cuarto|quinto|[1-5])$/.exec(said);
  if (pick) {
    const n = FILE_PICK[pick[1]] || Number(pick[1]);
    if (n >= 1 && n <= 5) return { kind: 'files', value: `pick|${n}`, pick: n };
  }

  const head = /^(?:busca(?:me|r)?|encontra(?:me|r)?|donde esta)(?: (?:el|la|mi|los|las|un|una))? (.+)$/.exec(said);
  if (!head) return null;
  const rest = head[1].trim().split(/\s+/).filter(Boolean);
  if (!rest.length) return null;
  const kind = parseFileKind(rest[0]);
  // require an explicit kind so "buscame una excusa" / "dónde está Discord" stay off this path
  if (!kind) return null;
  const words = sanitizeWords(rest.slice(1).filter((w) => !/^(?:de|del|la|el|los|las|un|una|mi|mis|al|a)$/.test(w)));
  if (!words) return null;
  return { kind: 'files', value: `${kind}|${words.join(' ')}`, fileKind: kind, words };
}

/** Direct chat/voice orders for volume / theme / snip / window / files (before music). */
function parsePcCommand(text, { apps = [] } = {}) {
  const { normalizeCommandText } = require('./command-text');
  const said = normalizeCommandText(text).replace(/\s+por favor$/, '').trim();
  if (!said) return null;

  const files = parseFindFilesCommand(said);
  if (files) return files;

  if (/^(?:(?:pon(?:e|me|eme)?|activa|cambia(?:me)?(?: a| al)?|pasa(?: a| al)?) )?(?:el |la )?(?:modo|tema) (?:oscuro|dark)$/.test(said)
    || /^(?:cambialo|cambiala) a (?:modo |tema )?(?:oscuro|dark)$/.test(said)
    || /^dark mode$/.test(said)) {
    return { kind: 'theme', value: 'dark' };
  }
  if (/^(?:(?:pon(?:e|me|eme)?|activa|cambia(?:me)?(?: a| al)?|pasa(?: a| al)?) )?(?:el |la )?(?:modo|tema) (?:claro|light)$/.test(said)
    || /^(?:cambialo|cambiala) a (?:modo |tema )?(?:claro|light)$/.test(said)
    || /^light mode$/.test(said)) {
    return { kind: 'theme', value: 'light' };
  }

  if (/^(?:silencio|silencia|mutea|mute|quita(?: el)? sonido)$/.test(said)) {
    return { kind: 'volume', value: 'mute' };
  }
  if (/^(?:desmutea|unmute|quita(?: el)? silencio|activa(?: el)? sonido|restaura(?: el)? sonido|con sonido)$/.test(said)) {
    return { kind: 'volume', value: 'unmute' };
  }

  // ±10%: need volumen/sonido or más alto/bajo/fuerte/despacio/bajito — bare subí/bajá → LLM
  if (/^(?:(?:sube|subi)(?:le)?(?: el )?(?:volumen|sonido)|mas(?: (?:alto|fuerte)| volumen))$/.test(said)) {
    return { kind: 'volume', value: 'up' };
  }
  if (/^(?:(?:baja|baje)(?:le)?(?: el )?(?:volumen|sonido)|menos(?: (?:alto|volumen)| volumen)|mas(?: (?:bajo|despacio|bajito)))$/.test(said)) {
    return { kind: 'volume', value: 'down' };
  }

  const set = /^(?:(?:pon(?:e|me|eme)? )?(?:el )?volumen(?: a| al| en)? |volumen(?: a| al)? )(\d{1,3})\s*%?$/.exec(said);
  if (set) {
    const n = Number(set[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return { kind: 'volume', value: String(Math.round(n)) };
  }

  // Screen snip (not screen-look, not NVIDIA/Game Bar clip)
  if (/^(?:recorta(?:r)?(?: la)? pantalla|captura de recorte|saca(?:me)? un recorte)$/.test(said)) {
    return { kind: 'snip', value: '' };
  }

  // Two apps: "X a la izquierda y Y a la derecha" / "dividí la pantalla con X y Y"
  const dual = /^(.+?) a la izquierda y (.+?) a la derecha$/.exec(said);
  if (dual) {
    const a = resolveAppProcess(dual[1], apps);
    const b = resolveAppProcess(dual[2], apps);
    if (a && b) {
      return {
        kind: 'window',
        value: `${a.app}|left+${b.app}|right`,
        snaps: [
          windowAction(a.app, a.process, 'left'),
          windowAction(b.app, b.process, 'right'),
        ],
      };
    }
  }
  const splitScreen = /^dividi(?:r)?(?: la)? pantalla con (.+?) y (.+)$/.exec(said);
  if (splitScreen) {
    const a = resolveAppProcess(splitScreen[1], apps);
    const b = resolveAppProcess(splitScreen[2], apps);
    if (a && b) {
      return {
        kind: 'window',
        value: `${a.app}|left+${b.app}|right`,
        snaps: [
          windowAction(a.app, a.process, 'left'),
          windowAction(b.app, b.process, 'right'),
        ],
      };
    }
  }

  const mm = /^(?:maximiza|minimiza|restaura)(?:me)? (.+)$/.exec(said);
  if (mm) {
    const pos = said.startsWith('maximiza') ? 'max' : said.startsWith('minimiza') ? 'min' : 'restore';
    const hit = resolveAppProcess(mm[1], apps);
    if (hit) return windowAction(hit.app, hit.process, pos);
  }

  const move = /^(?:pon(?:e|me|eme)?|move|manda)(?:me)? (.+?) a la (izquierda|derecha)$/.exec(said);
  if (move) {
    const hit = resolveAppProcess(move[1], apps);
    if (hit) return windowAction(hit.app, hit.process, move[2]);
    return null; // known shape, unknown app → LLM (not music search)
  }

  // Bare "<app> a la izquierda|derecha" for multi-command halves
  const bare = /^(.+?) a la (izquierda|derecha)$/.exec(said);
  if (bare) {
    const hit = resolveAppProcess(bare[1], apps);
    if (hit) return windowAction(hit.app, hit.process, bare[2]);
  }

  return null;
}

/**
 * Run one allowlisted PC action. `{ kind, value }` from mood-tag.
 * Never throws; failures return `{ ok:false, line }`.
 */
async function run(action, deps = {}) {
  const kind = String(action?.kind || '').toLowerCase();
  const value = String(action?.value || '').trim();
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') return fail('Eso solo funciona en Windows.');
  if (kind === 'snip' || (kind === 'pc' && value.toLowerCase() === 'snip')) return startSnip(deps);
  if (kind === 'window') return snapWindows(action, deps);
  if (kind === 'files') return runFiles(action, deps);
  if (!allowed(kind, value)) return fail('Esa acción de PC no está permitida.');
  if (kind === 'volume') return setVolume(value, deps);
  if (kind === 'settings') return openSettings(value, deps);
  if (kind === 'theme') return setTheme(value, deps);
  if (kind === 'info') {
    const got = await info(value, deps);
    return { ok: true, line: got.line, info: value };
  }
  return fail('Esa acción de PC no está permitida.');
}

module.exports = {
  SETTINGS,
  SETTINGS_PAGES,
  VOLUME_WORDS,
  THEME_VALUES,
  INFO_KINDS,
  WINDOW_POSITIONS,
  FILE_KINDS,
  FILE_EXTS,
  TIMEOUT_MS,
  FIND_TIMEOUT_MS,
  parseVolumeValue,
  parseSettingsValue,
  parseThemeValue,
  parseInfoValue,
  parseWindowPosition,
  parseWindowValue,
  parseFileKind,
  parseFilesValue,
  sanitizeWords,
  sanitizeProcess,
  resolveAppProcess,
  combineWindowResults,
  nameMatchesWords,
  buildSnapCommand,
  buildFindCommand,
  validateUserFilePath,
  allowed,
  run,
  info,
  contextSnippet,
  detectInfoKinds,
  parsePcCommand,
  getLastFileHits: () => lastFileHits.slice(),
  setLastFileHits: (hits) => { lastFileHits = Array.isArray(hits) ? hits.slice(0, FIND_TOP) : []; },
  NO_BATTERY,
  powershell,
};
