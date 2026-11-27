import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

    // Ensure profiles.json does not contain plaintext password
    const rawProfiles = await readFile(join(dir, "profiles.json"), "utf8");
    assert.equal(rawProfiles.includes("super-secret-password"), false);

    // Ensure secrets resolve on server side
    const conn = await store.getProfileWithSecrets(saved.id);
    assert.equal(conn.password, "super-secret-password");

    // Authorization selection
    const selected = await store.setSelectedIds([saved.id, saved.id]);
    assert.deepEqual(selected, [saved.id]);

    // Delete removes profile, selection, and credential
    await store.deleteProfile(saved.id);
    const snap = await store.snapshot();
    assert.deepEqual(snap.profiles, []);
    assert.deepEqual(snap.serverIds, []);
    assert.equal(await creds.load(`connection-profile:${saved.id}:password`), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("quotePosixShellArg safely escapes single quotes", () => {
  assert.equal(quotePosixShellArg("/tmp/a'b c.txt"), `'/tmp/a'\\''b c.txt'`);
});
