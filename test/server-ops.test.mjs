import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { installPlugin, uninstallPlugin } from "../src/cli.mjs";
import { createCredentialStore } from "../src/credential-store.mjs";
import {
  buildWindowsDirectScript,
  parseDarwinPhysicalInterface,
} from "../src/direct-socket.mjs";
import { createProfileStore } from "../src/profile-store.mjs";
import { quotePosixShellArg, testConnection } from "../src/ssh-backend.mjs";
import {
  checkForUpdates,
  compareSemver,
  extractReleaseSummary,
} from "../src/update-checker.mjs";
import {
  createUpdateManager,
  extractPluginFilesFromTgz,
  isManagedPluginDir,
  verifyTarballDigest,
} from "../src/update-manager.mjs";

test("profileStore separates metadata from encrypted credentials and never leaks secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-ops-profile-test-"));
  try {
    const creds = createCredentialStore(dir, { preferKeychain: false });
    const store = createProfileStore(dir, creds);

    const saved = await store.saveProfile({
      displayName: "Prod Web",
      host: "10.0.0.10",
      port: 2222,
      username: "deploy",
      authType: "password",
      password: "super-secret-password",
    });

    assert.equal(saved.name, "Prod Web");
    assert.equal(saved.hasPassword, true);
    assert.equal("password" in saved, false);

    const rawProfiles = await readFile(join(dir, "profiles.json"), "utf8");
    assert.equal(rawProfiles.includes("super-secret-password"), false);

    const conn = await store.getProfileWithSecrets(saved.id);
    assert.equal(conn.password, "super-secret-password");

    const selected = await store.setSelectedIds([saved.id, saved.id]);
    assert.deepEqual(selected, [saved.id]);

    await store.deleteProfile(saved.id);
    const snap = await store.snapshot();
    assert.deepEqual(snap.profiles, []);
    assert.deepEqual(snap.serverIds, []);
    assert.equal(await creds.load(`connection-profile:${saved.id}:password`), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installPlugin copies all required Antigravity plugin files and uninstallPlugin removes them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-ops-install-test-"));
  const target = join(dir, "server-ops");
  try {
    await installPlugin(target);
    for (const rel of [
      "plugin.json",
      "mcp_config.json",
      "skills/server-ops/SKILL.md",
      "dist/server.mjs",
      "dist/picker.html",
    ]) {
      await access(join(target, rel));
    }
    await uninstallPlugin(target);
    await assert.rejects(() => access(target));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("quotePosixShellArg safely escapes single quotes", () => {
  assert.equal(quotePosixShellArg("/tmp/a'b c.txt"), `'/tmp/a'\\''b c.txt'`);
});

test("profileStore persists bypassProxy toggle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-ops-bypass-test-"));
  try {
    const creds = createCredentialStore(dir, { preferKeychain: false });
    const store = createProfileStore(dir, creds);

    const saved = await store.saveProfile({
      displayName: "HK Server",
      host: "45.207.216.133",
      port: 22,
      username: "root",
      authType: "password",
      password: "secret",
      bypassProxy: true,
    });
    assert.equal(saved.bypassProxy, true);

    const updated = await store.saveProfile({
      profileId: saved.id,
      displayName: "HK Server",
      host: "45.207.216.133",
      port: 22,
      username: "root",
      authType: "password",
      bypassProxy: false,
    });
    assert.equal(updated.bypassProxy, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseDarwinPhysicalInterface skips utun/bridge and selects physical en0", () => {
  const sample = `
Destination        Gateway            Flags               Netif Expire
default            link#27            UCSIg               utun7
default            link#21            UCSIg           bridge100      !
default            172.20.10.1        UGScg                 en0
128.0/1            198.18.0.1         UGSc                utun6
`;
  assert.equal(parseDarwinPhysicalInterface(sample), "en0");
});

test("buildWindowsDirectScript binds IP_UNICAST_IF (option 31) with target host and port", () => {
  const script = buildWindowsDirectScript({ host: "45.207.216.133", port: 2222, timeoutMs: 12000 });
  assert.match(script, /SocketOptionName\]31/);
  assert.match(script, /HostToNetworkOrder/);
  assert.match(script, /45\.207\.216\.133/);
  assert.match(script, /2222/);
});

test("compareSemver and checkForUpdates check npm first and fallback to GitHub", async () => {
  assert.equal(compareSemver("0.3.0", "0.2.0"), 1);
  assert.equal(compareSemver("v0.3.0", "0.3.0"), 0);
  assert.equal(compareSemver("0.1.9", "0.2.0"), -1);

  const npmHit = await checkForUpdates({
    currentVersion: "0.2.0",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ version: "0.3.0" }),
    }),
  });
  assert.equal(npmHit.hasUpdate, true);
  assert.equal(npmHit.latestVersion, "0.3.0");

  let calls = 0;
  const fallbackHit = await checkForUpdates({
    currentVersion: "0.3.0",
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 2) return { ok: false, status: 404 };
      return {
        ok: true,
        json: async () => ({ version: "0.3.0" }),
      };
    },
  });
  assert.equal(fallbackHit.hasUpdate, false);
  assert.equal(fallbackHit.latestVersion, "0.3.0");
});

test("testConnection with bypassProxy rejects cleanly without unhandled error event on unreachable port", async () => {
  if (process.platform !== "darwin") return;
  await assert.rejects(
    () =>
      testConnection(
        {
          profile: {
            target: {
              host: "127.0.0.1",
              port: 1,
              username: "root",
              bypassProxy: true,
            },
          },
          password: "dummy",
        },
        { signal: AbortSignal.timeout(4000) },
      ),
    (err) => err instanceof Error && err.message.length > 0,
  );
});

function buildTarGz(entries) {
  const blocks = [];
  for (const [name, contentInput] of entries) {
    const content = Buffer.isBuffer(contentInput) ? contentInput : Buffer.from(contentInput, "utf8");
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

    blocks.push(header);
    blocks.push(content);
    const rem = content.length % 512;
    if (rem !== 0) blocks.push(Buffer.alloc(512 - rem, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

test("extractReleaseSummary cleans markdown and truncates cleanly", () => {
  const md = `## What's Changed\n- **新增** 右下角悬浮更新卡片 ([PR #12](https://github.com/aqcool/server-ops/pull/12))\n- 支持一键原地更新\n`;
  const summary = extractReleaseSummary(md);
  assert.match(summary, /新增 右下角悬浮更新卡片/);
  assert.match(summary, /支持一键原地更新/);
  assert.equal(summary.includes("**"), false);
});

test("extractPluginFilesFromTgz validates whitelist, blocks traversal, and verifyTarballDigest checks hashes", () => {
  const tgz = buildTarGz([
    ["package/plugin.json", JSON.stringify({ name: "server-ops", version: "0.3.2" })],
    ["package/mcp_config.json", "{}"],
    ["package/dist/server.mjs", "// server"],
    ["package/dist/picker.html", "<html></html>"],
    ["package/skills/server-ops/SKILL.md", "# skill"],
    ["package/../../evil.txt", "nope"],
    ["package/README.md", "ignored"],
  ]);

  const integrity = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
  verifyTarballDigest(tgz, { integrity });
  assert.throws(() => verifyTarballDigest(Buffer.concat([tgz, Buffer.from("x")]), { integrity }));

  const files = extractPluginFilesFromTgz(tgz);
  assert.equal(files.has("plugin.json"), true);
  assert.equal(files.has("skills/server-ops/SKILL.md"), true);
  assert.equal(files.has("../../evil.txt"), false);
  assert.equal(files.has("README.md"), false);
});

test("updateManager supports dismiss, force check, verified in-place install, and protects git repos", async () => {
  const root = await mkdtemp(join(tmpdir(), "server-ops-update-test-"));
  const dataDir = join(root, "data");
  const installDir = join(root, "plugin");
  const gitRepoDir = join(root, "repo");
  try {
    await mkdir(join(installDir, "dist"), { recursive: true });
    await writeFile(join(installDir, "plugin.json"), JSON.stringify({ name: "server-ops", version: "0.3.1" }));
    await writeFile(join(installDir, "mcp_config.json"), "{}");
    await writeFile(join(installDir, "dist", "server.mjs"), "// old");
    await writeFile(join(installDir, "dist", "picker.html"), "<html>old</html>");

    await mkdir(join(gitRepoDir, ".git"), { recursive: true });
    await writeFile(join(gitRepoDir, "plugin.json"), JSON.stringify({ name: "server-ops", version: "0.3.1" }));
    assert.equal(await isManagedPluginDir(installDir), true);
    assert.equal(await isManagedPluginDir(gitRepoDir), false);

    const newTgz = buildTarGz([
      ["package/plugin.json", JSON.stringify({ name: "server-ops", version: "0.3.2" })],
      ["package/mcp_config.json", JSON.stringify({ mcpServers: {} })],
      ["package/dist/server.mjs", "// new v0.3.2"],
      ["package/dist/picker.html", "<html>v0.3.2</html>"],
      ["package/skills/server-ops/SKILL.md", "# updated skill"],
    ]);
    const integrity = `sha512-${createHash("sha512").update(newTgz).digest("base64")}`;
    const tarballUrl = "https://registry.npmjs.org/antigravity-server-ops/-/antigravity-server-ops-0.3.2.tgz";

    const mockFetch = async (url) => {
      if (String(url).includes("/latest")) {
        return {
          ok: true,
          json: async () => ({
            version: "0.3.2",
            dist: { tarball: tarballUrl, integrity },
          }),
        };
      }
      if (String(url).includes("/releases/tags/v0.3.2")) {
        return {
          ok: true,
          json: async () => ({
            html_url: "https://github.com/aqcool/server-ops/releases/tag/v0.3.2",
            name: "v0.3.2",
            body: "## What's Changed\n- 新增悬浮更新卡片与一键原地升级",
          }),
        };
      }
      if (String(url) === tarballUrl) {
        return {
          ok: true,
          url: tarballUrl,
          arrayBuffer: async () => newTgz.buffer.slice(newTgz.byteOffset, newTgz.byteOffset + newTgz.byteLength),
        };
      }
      return { ok: false, status: 404 };
    };

    const manager = createUpdateManager({
      dataDir,
      installDir,
      currentVersion: "0.3.1",
      fetchImpl: mockFetch,
    });

    const first = await manager.check();
    assert.equal(first.hasUpdate, true);
    assert.equal(first.canInstall, true);
    assert.equal(first.ignored, false);
    assert.match(first.summary, /悬浮更新卡片/);

    await manager.dismiss("0.3.2");
    const dismissed = await manager.check();
    assert.equal(dismissed.ignored, true);
    const forced = await manager.check({ force: true });
    assert.equal(forced.ignored, false);

    const started = await manager.startInstall("0.3.2");
    assert.equal(started.status, "preparing");

    let finalState = started;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      finalState = await manager.status();
      if (["completed", "failed", "rolled-back"].includes(finalState.status)) break;
    }
    assert.equal(finalState.status, "completed");

    const updatedServer = await readFile(join(installDir, "dist", "server.mjs"), "utf8");
    assert.equal(updatedServer, "// new v0.3.2");
    const updatedSkill = await readFile(join(installDir, "skills", "server-ops", "SKILL.md"), "utf8");
    assert.equal(updatedSkill, "# updated skill");

    // 升级后以新版本号重启 manager，状态应自动复位为 idle
    const reloadedManager = createUpdateManager({
      dataDir,
      installDir,
      currentVersion: "0.3.2",
      fetchImpl: mockFetch,
    });
    assert.equal((await reloadedManager.status()).status, "idle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
