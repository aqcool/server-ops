import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { Client } from "ssh2";
import { createDirectStream } from "./direct-socket.mjs";

const OUTPUT_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 15_000;

export function quotePosixShellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function expandHome(filePath) {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

async function buildConnectConfig({ profile, password, passphrase }, signal) {
  const { target } = profile;
  const config = {
    host: target.host,
    port: target.port ?? 22,
    username: target.username,
    readyTimeout: CONNECT_TIMEOUT_MS,
  };

  if (target.privateKeyPath) {
    config.privateKey = await readFile(expandHome(target.privateKeyPath));
    if (passphrase) config.passphrase = passphrase;
  } else if (password) {
    config.password = password;
  } else if (process.env.SSH_AUTH_SOCK) {
    config.agent = process.env.SSH_AUTH_SOCK;
  }

  let directStream = null;
  if (target.bypassProxy) {
    const direct = await createDirectStream({
      host: target.host,
      port: target.port ?? 22,
      signal,
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    directStream = direct.stream;
    config.sock = directStream;
  }

  return { config, directStream };
}

async function withSshClient(connectionInput, signal, timeoutMs, fn) {
  const combinedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  if (combinedSignal.aborted) {
    throw combinedSignal.reason ?? new Error("Operation aborted.");
  }

  const { config, directStream } = await buildConnectConfig(connectionInput, combinedSignal);
  const client = new Client();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      combinedSignal.removeEventListener("abort", onAbort);
      try {
        client.end();
      } catch {}
      try {
        directStream?.destroy();
      } catch {}
      if (err) reject(err);
      else resolve(value);
    };

    const onAbort = () => {
      try {
        client.destroy();
      } catch {}
      try {
        directStream?.destroy();
      } catch {}
      finish(combinedSignal.reason ?? new Error("Operation aborted."));
    };

    combinedSignal.addEventListener("abort", onAbort, { once: true });

    if (directStream) {
      directStream.once("error", (err) => finish(err));
    }
    client.once("error", (err) => finish(err));
    client.once("ready", async () => {
      try {
        const result = await fn(client, combinedSignal);
        finish(null, result);
      } catch (err) {
        finish(err);
      }
    });

    client.connect(config);
  });
}

function collectStream(stream) {
  return new Promise((resolve) => {
    let remaining = OUTPUT_LIMIT_BYTES;
    const chunks = [];
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
      remaining -= bytes.length;
    });
    stream.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(remaining < 0 ? `${text}\n[output truncated]` : text);
    });
  });
}

function execOnClient(client, command, signal) {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, channel) => {
      if (err) return reject(err);
      const stdoutPromise = collectStream(channel);
      const stderrPromise = collectStream(channel.stderr);
      const onAbort = () => {
        try {
          channel.close();
        } catch {}
        reject(signal.reason ?? new Error("Command aborted."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      channel.once("close", async (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) return;
        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
        resolve({ stdout, stderr, exitCode: typeof code === "number" ? code : -1 });
      });
    });
  });
}

function sftpOnClient(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err);
      else resolve(sftp);
    });
  });
}

function sftpFastPut(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function sftpExists(sftp, remotePath) {
  return new Promise((resolve) => {
    sftp.stat(remotePath, (err) => resolve(!err));
  });
}

export async function testConnection(connectionInput, { signal } = {}) {
  return withSshClient(connectionInput, signal, CONNECT_TIMEOUT_MS + 5_000, async (client, sig) => {
    const res = await execOnClient(client, "uname -s -n", sig);
    return {
      ok: res.exitCode === 0,
      info: res.stdout.trim() || "Connected",
    };
  });
}

export async function execRemote(connectionInput, command, { signal } = {}) {
  return withSshClient(connectionInput, signal, DEFAULT_TIMEOUT_MS, (client, sig) =>
    execOnClient(client, command, sig),
  );
}

export async function uploadRemote(
  connectionInput,
  localSourcePath,
  remoteDestination,
  { overwrite = "error", signal } = {},
) {
  if (
    !posix.isAbsolute(remoteDestination) ||
    remoteDestination.endsWith("/") ||
    posix.basename(remoteDestination) === "." ||
    posix.basename(remoteDestination) === ".."
  ) {
    throw new Error("Enter an absolute destination file path.");
  }

  return withSshClient(connectionInput, signal, DEFAULT_TIMEOUT_MS, async (client, sig) => {
    const sftp = await sftpOnClient(client);
    if (overwrite === "skip" || overwrite === "error") {
      const exists = await sftpExists(sftp, remoteDestination);
      if (exists) {
        if (overwrite === "skip") {
          return { destination: remoteDestination, skipped: true };
        }
        throw new Error(`Destination already exists: ${remoteDestination}`);
      }
    }

    const stage = posix.join(
      posix.dirname(remoteDestination),
      `.server-ops-upload-${randomUUID()}`,
    );
    const stageQuoted = quotePosixShellArg(stage);
    const destQuoted = quotePosixShellArg(remoteDestination);

    try {
      await sftpFastPut(sftp, localSourcePath, stage);
      const publishCmd =
        overwrite === "replace"
          ? `mv -f ${stageQuoted} ${destQuoted}`
          : `test ! -e ${destQuoted} && mv -n ${stageQuoted} ${destQuoted}`;
      const publishRes = await execOnClient(client, publishCmd, sig);
      if (publishRes.exitCode !== 0) {
        throw new Error(
          publishRes.stderr.trim() || `Failed to publish uploaded file to ${remoteDestination}.`,
        );
      }
    } catch (error) {
      await execOnClient(client, `rm -f ${stageQuoted}`, AbortSignal.timeout(5_000)).catch(
        () => {},
      );
      throw error;
    }

    return { destination: remoteDestination };
  });
}
