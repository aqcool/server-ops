import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installPlugin, uninstallPlugin } from "../src/cli.mjs";
import { createCredentialStore } from "../src/credential-store.mjs";
import { createProfileStore } from "../src/profile-store.mjs";
import { quotePosixShellArg } from "../src/ssh-backend.mjs";

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
