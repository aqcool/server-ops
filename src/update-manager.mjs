import { createHash, randomUUID } from "node:crypto";
import { access, chmod, cp, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { checkForUpdates, compareSemver } from "./update-checker.mjs";

const MAX_TARBALL_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 32 * 1024 * 1024;
const STALE_INSTALL_MS = 180_000;
const ALLOWED_TARBALL_HOSTS = new Set(["registry.npmjs.org"]);

const REQUIRED_PLUGIN_FILES = [
  "plugin.json",
  "mcp_config.json",
  "dist/server.mjs",
  "dist/picker.html",
];

function isAllowedPluginRelativePath(relPath) {
  if (
    relPath === "plugin.json" ||
    relPath === "mcp_config.json" ||
    relPath === "dist/server.mjs" ||
    relPath === "dist/picker.html"
  ) {
    return true;
  }
  return relPath.startsWith("skills/") && !relPath.endsWith("/");
}

function readTarString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString("utf8");
}

function readTarOctal(buf, start, length) {
  const raw = readTarString(buf, start, length).trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid tar entry size.");
  }
  return parsed;
}

function normalizeTarPath(rawName) {
  const cleaned = rawName.replaceAll("\\", "/").replace(/^\.\//, "");
  // npm pack 包内文件统一以 package/ 开头
  const stripped = cleaned.startsWith("package/") ? cleaned.slice("package/".length) : cleaned;
  const normalized = posix.normalize(stripped);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  return normalized;
}

/**
 * 纯 JS 解析标准 npm .tgz (gzip + USTAR tar)，仅提取插件白名单文件并防范路径穿越与压缩炸弹。
 */
export function extractPluginFilesFromTgz(tgzBuffer) {
  const tar = gunzipSync(tgzBuffer, { maxOutputLength: MAX_EXTRACTED_BYTES });
  const files = new Map();
  let offset = 0;
  let totalSize = 0;
  let pendingLongName = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // 连续全零块表示 tar 归档结束
    let isZeroBlock = true;
    for (let i = 0; i < 512; i += 1) {
      if (header[i] !== 0) {
        isZeroBlock = false;
        break;
      }
    }
    if (isZeroBlock) break;

    const namePart = readTarString(header, 0, 100);
    const size = readTarOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 48);
    const prefix = readTarString(header, 345, 155);
    const rawName = pendingLongName ?? (prefix ? `${prefix}/${namePart}` : namePart);
    pendingLongName = null;

    offset += 512;
    const dataEnd = offset + size;
    if (dataEnd > tar.length) {
      throw new Error("Truncated tar archive.");
    }
    const content = Buffer.from(tar.subarray(offset, dataEnd));
    offset += Math.ceil(size / 512) * 512;

    if (typeFlag === "L") {
      // GNU tar 长文件名扩展
      pendingLongName = content.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (typeFlag === "x" || typeFlag === "g") {
      // PAX 扩展头（若包含 path 字段则提取）
      const text = content.toString("utf8");
      const match = text.match(/\d+\s+path=([^\n]+)\n/);
      if (match?.[1]) pendingLongName = match[1];
      continue;
    }
    if (typeFlag !== "0" && typeFlag !== "\0") {
      continue;
    }

    const relPath = normalizeTarPath(rawName);
    if (!relPath || !isAllowedPluginRelativePath(relPath)) continue;

    totalSize += content.length;
    if (totalSize > MAX_EXTRACTED_BYTES) {
      throw new Error("Extracted plugin package exceeds size limit.");
    }
    files.set(relPath, content);
  }

  for (const required of REQUIRED_PLUGIN_FILES) {
    if (!files.has(required)) {
      throw new Error(`Update package is missing required file: ${required}`);
    }
  }
  return files;
}

export function verifyTarballDigest(buffer, dist) {
  if (dist?.integrity) {
    const match = String(dist.integrity).match(/^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error("Unsupported package integrity format.");
    }
    const [, algo, expectedB64] = match;
    const actualB64 = createHash(algo).update(buffer).digest("base64");
    if (actualB64 !== expectedB64) {
      throw new Error("Package integrity verification failed.");
    }
    return;
  }
  if (dist?.shasum && /^[a-f0-9]{40}$/i.test(dist.shasum)) {
    const actualHex = createHash("sha1").update(buffer).digest("hex");
    if (actualHex.toLowerCase() !== dist.shasum.toLowerCase()) {
      throw new Error("Package shasum verification failed.");
    }
    return;
  }
  throw new Error("Update package is missing integrity metadata.");
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isManagedPluginDir(installDir) {
  if (!installDir) return false;
  const resolved = resolve(installDir);
  if (!(await exists(join(resolved, "plugin.json")))) return false;
  // 防止在本地 Git 开发仓库内误触发原地覆盖
  if (await exists(join(resolved, ".git"))) return false;
  return true;
}

async function downloadTarball(tarballUrl, fetchImpl, signal) {
  const parsed = new URL(tarballUrl);
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_TARBALL_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Untrusted update download URL.");
  }
  const response = await fetchImpl(tarballUrl, { signal, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download update package (HTTP ${response.status}).`);
  }
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !ALLOWED_TARBALL_HOSTS.has(finalUrl.hostname)) {
      throw new Error("Untrusted update redirect URL.");
    }
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0 || buffer.length > MAX_TARBALL_BYTES) {
    throw new Error("Downloaded update package size is invalid.");
  }
  return buffer;
}

async function writeAtomicFile(targetPath, content, mode) {
  await mkdir(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, mode ? { mode } : undefined);
    await rename(tmp, targetPath);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function tryRefreshAntigravityMcpServer(fetchImpl) {
  const token = process.env.ANTIGRAVITY_CSRF_TOKEN;
  if (!token) return false;
  const addr = process.env.ANTIGRAVITY_LS_ADDRESS || "localhost:5387";
  try {
    const res = await fetchImpl(
      `http://${addr}/exa.language_server_pb.LanguageServerService/RefreshMcpServers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": token,
        },
        body: JSON.stringify({ serverName: "server-ops_server-ops" }),
        signal: AbortSignal.timeout(2_500),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function createUpdateManager({
  dataDir,
  installDir,
  currentVersion,
  fetchImpl = globalThis.fetch,
  npmPackage,
  repo,
}) {
  const metaPath = join(dataDir, "update-meta.json");
  let writeChain = Promise.resolve();
  let installInFlight = false;
  let lastCheckedInfo = null;

  async function readMeta() {
    try {
      const raw = await readFile(metaPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        ignoredVersion:
          typeof parsed?.ignoredVersion === "string" && parsed.ignoredVersion.trim()
            ? parsed.ignoredVersion.trim()
            : null,
        installState:
          parsed?.installState && typeof parsed.installState === "object"
            ? parsed.installState
            : { status: "idle" },
      };
    } catch {
      return { ignoredVersion: null, installState: { status: "idle" } };
    }
  }

  function writeMeta(updater) {
    const next = writeChain.then(async () => {
      const current = await readMeta();
      const updated = (await updater(current)) ?? current;
      await writeAtomicFile(metaPath, JSON.stringify(updated, null, 2), 0o600);
      return updated;
    });
    writeChain = next.catch(() => {});
    return next;
  }

  async function getInstallState() {
    const meta = await readMeta();
    const state = meta.installState || { status: "idle" };
    const active = ["preparing", "downloading", "verifying", "installing"].includes(state.status);
    if (active && !installInFlight && Date.now() - (state.updatedAt || 0) > STALE_INSTALL_MS) {
      const failed = {
        status: "failed",
        version: state.version || "",
        error: "Update timed out.",
        updatedAt: Date.now(),
      };
      await writeMeta((cur) => ({ ...cur, installState: failed }));
      return failed;
    }
    if (
      state.status === "completed" &&
      state.version &&
      compareSemver(currentVersion, state.version) >= 0
    ) {
      const idle = { status: "idle" };
      await writeMeta((cur) => ({ ...cur, installState: idle }));
      return idle;
    }
    return state;
  }

  async function setInstallState(nextState) {
    const stamped = { ...nextState, updatedAt: Date.now() };
    await writeMeta((cur) => ({ ...cur, installState: stamped }));
    return stamped;
  }

  return {
    async check({ force = false } = {}) {
      const info = await checkForUpdates({
        currentVersion,
        fetchImpl,
        ...(npmPackage ? { npmPackage } : {}),
        ...(repo ? { repo } : {}),
      });
      lastCheckedInfo = info;

      const meta = await readMeta();
      const installState = await getInstallState();
      const managed = await isManagedPluginDir(installDir);
      const canInstall = Boolean(
        info.hasUpdate &&
          managed &&
          info.dist?.tarballUrl &&
          (info.dist?.integrity || info.dist?.shasum),
      );
      const ignored = Boolean(
        !force &&
          info.hasUpdate &&
          meta.ignoredVersion &&
          compareSemver(info.latestVersion, meta.ignoredVersion) <= 0,
      );

      return {
        currentVersion: info.currentVersion,
        latestVersion: info.latestVersion,
        hasUpdate: info.hasUpdate,
        releaseUrl: info.releaseUrl,
        releaseName: info.releaseName,
        summary: info.summary || "",
        canInstall,
        ignored,
        ignoredVersion: meta.ignoredVersion,
        installState,
        checkedAt: info.checkedAt,
      };
    },

    async dismiss(version) {
      const clean = String(version || "").trim().replace(/^v/i, "");
      const updated = await writeMeta((cur) => ({
        ...cur,
        ignoredVersion: clean || null,
      }));
      return { ignoredVersion: updated.ignoredVersion };
    },

    async status() {
      return getInstallState();
    },

    async startInstall(expectedVersion) {
      const targetVersion = String(expectedVersion || "").trim().replace(/^v/i, "");
      if (!targetVersion) {
        throw new Error("Target version is required.");
      }
      const existing = await getInstallState();
      if (
        installInFlight ||
        ["preparing", "downloading", "verifying", "installing"].includes(existing.status)
      ) {
        return existing;
      }

      if (!(await isManagedPluginDir(installDir))) {
        throw new Error(
          "In-place update is only available for installed plugins. Run `npx -y antigravity-server-ops init` to update.",
        );
      }

      // 优先使用最近一次刚检查的缓存，否则重新拉取最新元数据校验
      let info = lastCheckedInfo;
      if (!info || info.latestVersion !== targetVersion || !info.dist?.tarballUrl) {
        info = await checkForUpdates({
          currentVersion,
          fetchImpl,
          includeReleaseNotes: false,
          ...(npmPackage ? { npmPackage } : {}),
          ...(repo ? { repo } : {}),
        });
        lastCheckedInfo = info;
      }

      if (!info.hasUpdate || info.latestVersion !== targetVersion) {
        throw new Error("Available version changed. Please check for updates again.");
      }
      if (!info.dist?.tarballUrl || (!info.dist?.integrity && !info.dist?.shasum)) {
        throw new Error("This release does not provide a verifiable package for auto-update.");
      }

      installInFlight = true;
      const preparingState = await setInstallState({
        status: "preparing",
        version: targetVersion,
      });

      // 后台异步执行，避免阻塞 MCP tool 调用超时；前端通过 update_status 轮询实时进度
      void (async () => {
        const backupDir = join(dataDir, `.update-backup-${randomUUID()}`);
        const backedUpPaths = [];
        try {
          await setInstallState({ status: "downloading", version: targetVersion });
          const tgzBuffer = await downloadTarball(
            info.dist.tarballUrl,
            fetchImpl,
            AbortSignal.timeout(90_000),
          );

          await setInstallState({ status: "verifying", version: targetVersion });
          verifyTarballDigest(tgzBuffer, info.dist);
          const files = extractPluginFilesFromTgz(tgzBuffer);

          const pkgJsonRaw = files.get("plugin.json")?.toString("utf8") || "{}";
          const pluginMeta = JSON.parse(pkgJsonRaw);
          if (pluginMeta?.version && pluginMeta.version !== targetVersion) {
            throw new Error(
              `Package version mismatch: expected ${targetVersion}, got ${pluginMeta.version}.`,
            );
          }

          await setInstallState({ status: "installing", version: targetVersion });
          const targetRoot = resolve(installDir);

          // 备份将被覆盖的已有文件以便异常时回滚
          for (const relPath of files.keys()) {
            const absTarget = join(targetRoot, ...relPath.split("/"));
            if (await exists(absTarget)) {
              const absBackup = join(backupDir, ...relPath.split("/"));
              await mkdir(dirname(absBackup), { recursive: true });
              await cp(absTarget, absBackup, { force: true });
              backedUpPaths.push(relPath);
            }
          }

          // 原子写入新文件
          try {
            for (const [relPath, content] of files.entries()) {
              const absTarget = join(targetRoot, ...relPath.split("/"));
              await writeAtomicFile(absTarget, content);
            }
            await chmod(join(targetRoot, "dist", "server.mjs"), 0o755).catch(() => {});
          } catch (installErr) {
            // 回滚已备份文件
            let rolledBack = false;
            try {
              for (const relPath of backedUpPaths) {
                const absBackup = join(backupDir, ...relPath.split("/"));
                const absTarget = join(targetRoot, ...relPath.split("/"));
                await mkdir(dirname(absTarget), { recursive: true });
                await cp(absBackup, absTarget, { force: true });
              }
              rolledBack = backedUpPaths.length > 0;
            } catch {}
            await setInstallState({
              status: rolledBack ? "rolled-back" : "failed",
              version: targetVersion,
              error: installErr instanceof Error ? installErr.message : String(installErr),
            });
            return;
          }

          await setInstallState({
            status: "completed",
            version: targetVersion,
            reloaded: Boolean(process.env.ANTIGRAVITY_CSRF_TOKEN),
          });

          // 稍微延迟触发 Antigravity MCP Server 热刷新，确保前端先拿到 completed 状态
          if (process.env.ANTIGRAVITY_CSRF_TOKEN) {
            const timer = setTimeout(() => {
              void tryRefreshAntigravityMcpServer(fetchImpl);
            }, 900);
            timer.unref?.();
          }
        } catch (error) {
          await setInstallState({
            status: "failed",
            version: targetVersion,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          installInFlight = false;
          await rm(backupDir, { recursive: true, force: true }).catch(() => {});
        }
      })();

      return preparingState;
    },
  };
}
