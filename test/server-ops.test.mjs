import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { quotePosixShellArg } from "../src/ssh-backend.mjs";
import { parseSshConfigText } from "../src/ssh-config.mjs";
import { createBindingsStore } from "../src/store.mjs";

test("parseSshConfigText extracts concrete hosts and skips wildcards", () => {
  const sample = `
# Global defaults
Host *
  ServerAliveInterval 60

Host prod-web prod-api *.internal
  HostName 10.0.0.10
  User deploy
  Port 2222

Host staging
  HostName 10.0.0.20
  User ubuntu
`;
  const profiles = parseSshConfigText(sample);
  assert.deepEqual(profiles, [
    { id: "prod-web", name: "prod-web", subtitle: "deploy@10.0.0.10:2222" },
    { id: "prod-api", name: "prod-api", subtitle: "deploy@10.0.0.10:2222" },
    { id: "staging", name: "staging", subtitle: "ubuntu@10.0.0.20" },
  ]);
});

test("createBindingsStore persists deduplicated server IDs atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "server-ops-test-"));
  try {
    const store = createBindingsStore(join(dir, "bindings.json"));
    assert.deepEqual(await store.readIds(), []);
    const saved = await store.writeIds(["prod-web", "staging", "prod-web"]);
    assert.deepEqual(saved, ["prod-web", "staging"]);
    assert.deepEqual(await store.readIds(), ["prod-web", "staging"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("quotePosixShellArg safely escapes single quotes", () => {
  assert.equal(quotePosixShellArg("/tmp/a'b c.txt"), `'/tmp/a'\\''b c.txt'`);
});
