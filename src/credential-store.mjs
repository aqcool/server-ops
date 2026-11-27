import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "server-ops-mcp";

function isMacOS() {
  return process.platform === "darwin";
}

async function keychainLoad(account) {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { timeout: 5_000 },
    );
    return stdout.replace(/\r?\n$/, "");
  } catch (error) {
    if (error?.code === 44) return null; // errSecItemNotFound
    throw error;
  }
}

async function keychainSave(account, value) {
  await execFileAsync(
    "/usr/bin/security",
    ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", account, "-w", value],
    { timeout: 5_000 },
  );
}

async function keychainDelete(account) {
  try {
    await execFileAsync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account],
      { timeout: 5_000 },
    );
  } catch (error) {
    if (error?.code === 44) return;
    throw error;
  }
}

function createEncryptedFileStore(dataDir) {
  const keyFile = join(dataDir, ".credential.key");
  const vaultFile = join(dataDir, "credentials.enc.json");
  let writeChain = Promise.resolve();

  async function ensureMasterKey() {
    try {
      const hex = (await readFile(keyFile, "utf8")).trim();
      const buf = Buffer.from(hex, "hex");
      if (buf.length === 32) return buf;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(dirname(keyFile), { recursive: true });
    const key = randomBytes(32);
    const tmp = `${keyFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, key.toString("hex"), { mode: 0o600 });
    await rename(tmp, keyFile);
    return key;
  }

  async function readVault() {
    try {
      const raw = await readFile(vaultFile, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  async function writeVault(vault) {
    await mkdir(dirname(vaultFile), { recursive: true });
    const tmp = `${vaultFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(vault, null, 2), { mode: 0o600 });
      await rename(tmp, vaultFile);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
  }

  return {
    async load(key) {
      const vault = await readVault();
      const entry = vault[key];
      if (!entry?.iv || !entry?.tag || !entry?.data) return null;
      const masterKey = await ensureMasterKey();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        masterKey,
        Buffer.from(entry.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.data, "base64")),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    },
    save(key, value) {
      const next = writeChain.then(async () => {
        const masterKey = await ensureMasterKey();
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
        const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        const vault = await readVault();
        vault[key] = {
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: encrypted.toString("base64"),
        };
        await writeVault(vault);
      });
      writeChain = next.catch(() => {});
      return next;
    },
    delete(key) {
      const next = writeChain.then(async () => {
        const vault = await readVault();
        if (key in vault) {
          delete vault[key];
          await writeVault(vault);
        }
      });
      writeChain = next.catch(() => {});
      return next;
    },
  };
}

/**
 * ZCode-style key-value credential store:
 * - On macOS, stores secrets in the OS Login Keychain (same backing store as Electron safeStorage),
 *   falling back to AES-256-GCM encrypted file if keychain access is unavailable (e.g. headless CI).
 * - On Linux/Windows, uses AES-256-GCM encrypted file with 0600 permissions inside dataDir.
 */
export function createCredentialStore(dataDir, { preferKeychain = isMacOS() } = {}) {
  const fallback = createEncryptedFileStore(dataDir);
  let useKeychain = preferKeychain;

  return {
    async load(key) {
      if (useKeychain) {
        try {
          return await keychainLoad(key);
        } catch {
          useKeychain = false;
        }
      }
      return fallback.load(key);
    },
    async save(key, value) {
      if (useKeychain) {
        try {
          await keychainSave(key, value);
          return;
        } catch {
          useKeychain = false;
        }
      }
      await fallback.save(key, value);
    },
    async delete(key) {
      if (useKeychain) {
        try {
          await keychainDelete(key);
          return;
        } catch {
          useKeychain = false;
        }
      }
      await fallback.delete(key);
    },
  };
}
