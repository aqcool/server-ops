import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";

const OUTPUT_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export function quotePosixShellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    let remaining = OUTPUT_LIMIT_BYTES;
    const chunks = [];
    stream.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
      remaining -= bytes.length;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(remaining < 0 ? `${text}\n[output truncated]` : text);
    });
  });
}

function runProcess(command, args, signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    if (combinedSignal.aborted) {
      reject(combinedSignal.reason ?? new Error("Operation aborted."));
      return;
    }

    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutPromise = collectStream(child.stdout);
    const stderrPromise = collectStream(child.stderr);

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      reject(combinedSignal.reason ?? new Error("Operation aborted."));
    };

    combinedSignal.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      combinedSignal.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.once("close", async (code) => {
      combinedSignal.removeEventListener("abort", onAbort);
      if (combinedSignal.aborted) return;
      try {
        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sshBaseArgs(sshConfigPath) {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  if (sshConfigPath) {
    args.push("-F", sshConfigPath);
  }
  return args;
}

export async function execRemote(hostAlias, command, { signal, sshConfigPath } = {}) {
  const args = [...sshBaseArgs(sshConfigPath), "--", hostAlias, command];
  return runProcess("ssh", args, signal);
}

export async function uploadRemote(
  hostAlias,
  localSourcePath,
  remoteDestination,
  { overwrite = "error", signal, sshConfigPath } = {},
) {
  if (
    !posix.isAbsolute(remoteDestination) ||
    remoteDestination.endsWith("/") ||
    posix.basename(remoteDestination) === "." ||
    posix.basename(remoteDestination) === ".."
  ) {
    throw new Error("Enter an absolute destination file path.");
  }

  const destQuoted = quotePosixShellArg(remoteDestination);

  if (overwrite === "skip" || overwrite === "error") {
    const check = await execRemote(hostAlias, `test -e ${destQuoted}`, { signal, sshConfigPath });
    if (check.exitCode === 0) {
      if (overwrite === "skip") {
        return { destination: remoteDestination, skipped: true };
      }
      throw new Error(`Destination already exists: ${remoteDestination}`);
    }
  }

  const stage = posix.join(posix.dirname(remoteDestination), `.server-ops-upload-${randomUUID()}`);
  const stageQuoted = quotePosixShellArg(stage);

  try {
    const scpArgs = [
      ...sshBaseArgs(sshConfigPath),
      "--",
      localSourcePath,
      `${hostAlias}:${stage}`,
    ];
    const uploadResult = await runProcess("scp", scpArgs, signal);
    if (uploadResult.exitCode !== 0) {
      throw new Error(uploadResult.stderr.trim() || `scp exited with code ${uploadResult.exitCode}`);
    }

    const publishCmd =
      overwrite === "replace"
        ? `mv -f ${stageQuoted} ${destQuoted}`
        : `test ! -e ${destQuoted} && mv -n ${stageQuoted} ${destQuoted}`;
    const publishResult = await execRemote(hostAlias, publishCmd, { signal, sshConfigPath });
    if (publishResult.exitCode !== 0) {
      throw new Error(
        publishResult.stderr.trim() || `Failed to publish uploaded file to ${remoteDestination}.`,
      );
    }
  } catch (error) {
    await execRemote(hostAlias, `rm -f ${stageQuoted}`, {
      signal: AbortSignal.timeout(5_000),
      sshConfigPath,
    }).catch(() => {});
    throw error;
  }

  return { destination: remoteDestination };
}
