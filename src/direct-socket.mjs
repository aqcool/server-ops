import { execFile, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { Duplex } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DARWIN_VIRTUAL_IFACE_RE =
  /^(lo|utun|ppp|ipsec|bridge|awdl|llw|anpi|vmenet|feth|gif|stf|ap)\d*$/i;

/**
 * Parse `netstat -rn -f inet` output on macOS and pick the primary physical
 * interface that has a default route (excluding utun/bridge/lo/etc.).
 */
export function parseDarwinPhysicalInterface(netstatOutput) {
  const candidates = [];
  for (const rawLine of netstatOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("default")) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 4) continue;
    const gateway = cols[1];
    const iface = cols[3];
    if (!iface || DARWIN_VIRTUAL_IFACE_RE.test(iface)) continue;
    const hasIpv4Gateway = /^\d+\.\d+\.\d+\.\d+$/.test(gateway);
    candidates.push({ iface, hasIpv4Gateway });
  }
  const preferred =
    candidates.find((c) => c.hasIpv4Gateway && /^en\d+$/i.test(c.iface)) ??
    candidates.find((c) => c.hasIpv4Gateway) ??
    candidates.find((c) => /^en\d+$/i.test(c.iface)) ??
    candidates[0];
  return preferred?.iface ?? null;
}

function fallbackDarwinInterface() {
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (DARWIN_VIRTUAL_IFACE_RE.test(name)) continue;
    if (addrs?.some((a) => a.family === "IPv4" && !a.internal)) {
      return name;
    }
  }
  return null;
}

export async function detectDarwinPhysicalInterface() {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/netstat", ["-rn", "-f", "inet"], {
      timeout: 3_000,
    });
    const parsed = parseDarwinPhysicalInterface(stdout);
    if (parsed) return parsed;
  } catch {
    // Fall through to os.networkInterfaces() fallback
  }
  const fallback = fallbackDarwinInterface();
  if (!fallback) {
    throw new Error("Could not detect an active physical network interface on macOS.");
  }
  return fallback;
}

function wrapChildAsDuplex(child, label) {
  let stderrText = "";
  let closed = false;

  child.stderr?.on("data", (chunk) => {
    if (stderrText.length < 2048) {
      stderrText += chunk.toString("utf8");
    }
  });

  const killChild = () => {
    if (closed) return;
    closed = true;
    try {
      child.stdin?.end();
    } catch {}
    try {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    } catch {}
  };

  const duplex = new Duplex({
    read() {
      child.stdout?.resume();
    },
    write(chunk, encoding, callback) {
      if (!child.stdin || child.stdin.destroyed) {
        callback(new Error(`${label} stream is closed.`));
        return;
      }
      if (child.stdin.write(chunk, encoding)) {
        callback();
      } else {
        child.stdin.once("drain", callback);
      }
    },
    final(callback) {
      try {
        child.stdin?.end();
      } catch {}
      callback();
    },
    destroy(err, callback) {
      killChild();
      callback(err);
    },
  });

  child.stdout?.on("data", (chunk) => {
    if (!duplex.push(chunk)) {
      child.stdout.pause();
    }
  });

  child.stdout?.on("end", () => {
    duplex.push(null);
  });

  child.on("error", (err) => {
    closed = true;
    duplex.destroy(new Error(`${label} failed to start: ${err.message}`));
  });

  child.on("exit", (code, sig) => {
    closed = true;
    if (duplex.destroyed) return;
    if (code && code !== 0) {
      const detail = stderrText.trim();
      duplex.destroy(
        new Error(
          detail
            ? `${label} exited (${code}): ${detail}`
            : `${label} exited with code ${code}${sig ? ` (${sig})` : ""}.`,
        ),
      );
    } else {
      duplex.push(null);
    }
  });

  return duplex;
}

/**
 * Build a Windows PowerShell script that connects a TCP socket bound to the
 * primary physical IPv4 interface via IP_UNICAST_IF (Winsock option 31, no
 * Administrator privileges required) and relays stdin/stdout as a raw stream.
 */
export function buildWindowsDirectScript({ host, port, timeoutMs }) {
  const escapedHost = String(host).replaceAll("'", "''");
  const safePort = Number(port);
  const safeTimeout = Math.max(1000, Number(timeoutMs) || 15000);
  return `
$ErrorActionPreference = 'Stop'
$excludeRe = 'wintun|clash|flclash|mihomo|meta|tap-|tailscale|wireguard|zerotier|vethernet|virtual|hyper-v|vmware|virtualbox|loopback|tunnel|teredo|isatap'
$ifIndex = $null
try {
  $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric, InterfaceMetric
  foreach ($r in $routes) {
    $ad = Get-NetAdapter -InterfaceIndex $r.InterfaceIndex -ErrorAction SilentlyContinue
    if ($null -eq $ad -or $ad.Status -ne 'Up') { continue }
    $desc = "$($ad.Name) $($ad.InterfaceDescription)"
    if ($desc -imatch $excludeRe) { continue }
    $ifIndex = [int]$r.InterfaceIndex
    break
  }
} catch {}

if ($null -eq $ifIndex) {
  [Console]::Error.WriteLine('Could not detect an active physical network interface on Windows.')
  exit 2
}

$targetHost = '${escapedHost}'
$targetPort = ${safePort}
$timeoutMs = ${safeTimeout}

$ip = $null
if (-not [System.Net.IPAddress]::TryParse($targetHost, [ref]$ip)) {
  $addrs = [System.Net.Dns]::GetHostAddresses($targetHost) | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork }
  if (-not $addrs -or $addrs.Length -eq 0) {
    [Console]::Error.WriteLine("Could not resolve IPv4 address for $targetHost")
    exit 3
  }
  $ip = $addrs[0]
}

$sock = New-Object System.Net.Sockets.Socket(
  [System.Net.Sockets.AddressFamily]::InterNetwork,
  [System.Net.Sockets.SocketType]::Stream,
  [System.Net.Sockets.ProtocolType]::Tcp
)
$sock.NoDelay = $true
$netOrderIf = [System.Net.IPAddress]::HostToNetworkOrder([int]$ifIndex)
$sock.SetSocketOption([System.Net.Sockets.SocketOptionLevel]::IP, [System.Net.Sockets.SocketOptionName]31, $netOrderIf)

$iar = $sock.BeginConnect($ip, $targetPort, $null, $null)
if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) {
  $sock.Close()
  [Console]::Error.WriteLine("Direct TCP connect timed out after $timeoutMs ms (ifIndex=$ifIndex)")
  exit 4
}
$sock.EndConnect($iar)

$netStream = New-Object System.Net.Sockets.NetworkStream($sock, $true)
$inStream = [Console]::OpenStandardInput()
$outStream = [Console]::OpenStandardOutput()

$t1 = $inStream.CopyToAsync($netStream)
$t2 = $netStream.CopyToAsync($outStream)
[System.Threading.Tasks.Task]::WaitAny(@($t1, $t2)) | Out-Null
try { $sock.Shutdown([System.Net.Sockets.SocketShutdown]::Both) } catch {}
try { $netStream.Close() } catch {}
`.trim();
}

/**
 * Create a Duplex TCP stream that bypasses TUN proxies on macOS and Windows.
 */
export async function createDirectStream({ host, port, signal, timeoutMs = 15_000 }) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Operation aborted.");
  }

  if (process.platform === "darwin") {
    const iface = await detectDarwinPhysicalInterface();
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const child = spawn("/usr/bin/nc", ["-G", String(timeoutSec), "-b", iface, host, String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stream = wrapChildAsDuplex(child, `Direct connect via ${iface}`);
    if (signal) {
      const onAbort = () => stream.destroy(signal.reason ?? new Error("Operation aborted."));
      signal.addEventListener("abort", onAbort, { once: true });
      stream.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    return { stream, iface };
  }

  if (process.platform === "win32") {
    const script = buildWindowsDirectScript({ host, port, timeoutMs });
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stream = wrapChildAsDuplex(child, "Windows direct connect");
    if (signal) {
      const onAbort = () => stream.destroy(signal.reason ?? new Error("Operation aborted."));
      signal.addEventListener("abort", onAbort, { once: true });
      stream.once("close", () => signal.removeEventListener("abort", onAbort));
    }
    return { stream, iface: "win32-physical" };
  }

  throw new Error(
    `Bypass Proxy (Direct Connect) is currently supported on macOS and Windows only (current: ${process.platform}).`,
  );
}
