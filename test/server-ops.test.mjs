import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installPlugin, uninstallPlugin } from "../src/cli.mjs";
import { createCredentialStore } from "../src/credential-store.mjs";
import {
  buildWindowsDirectScript,
  parseDarwinPhysicalInterface,
} from "../src/direct-socket.mjs";
import { createProfileStore } from "../src/profile-store.mjs";
import { quotePosixShellArg } from "../src/ssh-backend.mjs";
import { checkForUpdates, compareSemver } from "../src/update-checker.mjs";

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
