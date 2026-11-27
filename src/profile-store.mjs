import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function credentialKey(profileId, kind) {
  return `connection-profile:${profileId}:${kind}`;
}

export function createProfileStore(dataDir, credentialStore) {
  const filePath = join(dataDir, "profiles.json");
  let writeChain = Promise.resolve();

  async function readRaw() {
    try {
      const text = await readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      return {
        version: 1,
        profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [],
        selectedIds: Array.isArray(parsed?.selectedIds)
          ? parsed.selectedIds.filter((id) => typeof id === "string" && id.length > 0)
          : [],
      };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) {
        return { version: 1, profiles: [], selectedIds: [] };
      }
      throw error;
    }
  }

  function mutate(updater) {
    const next = writeChain.then(async () => {
      const state = await readRaw();
      const result = await updater(state);
      await mkdir(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(tmp, filePath);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
      return result;
    });
    writeChain = next.catch(() => {});
    return next;
  }

  function toPublicProfile(profile) {
    const port = profile.target.port ?? 22;
    const displayName =
      profile.displayName?.trim() || `${profile.target.username}@${profile.target.host}`;
    return {
      id: profile.profileId,
      name: displayName,
      displayName: profile.displayName ?? "",
      host: profile.target.host,
      port,
      username: profile.target.username,
      authType: profile.target.privateKeyPath ? "privateKey" : "password",
      privateKeyPath: profile.target.privateKeyPath ?? "",
      hasPassword: Boolean(profile.target.passwordCredentialKey),
      hasPassphrase: Boolean(profile.target.privateKeyPassphraseCredentialKey),
      lastConnectedAt: profile.lastConnectedAt ?? null,
      lastConnectError: profile.lastConnectError ?? null,
      subtitle: `${profile.target.username}@${profile.target.host}${port !== 22 ? `:${port}` : ""}`,
    };
  }

  return {
    async snapshot() {
      const state = await readRaw();
      const activeIds = new Set(state.profiles.map((p) => p.profileId));
      const selectedIds = state.selectedIds.filter((id) => activeIds.has(id));
      return {
        profiles: state.profiles.map(toPublicProfile),
        serverIds: selectedIds,
      };
    },

    async getProfileWithSecrets(profileId) {
      const state = await readRaw();
      const profile = state.profiles.find((p) => p.profileId === profileId);
      if (!profile) return null;
      const password = profile.target.passwordCredentialKey
        ? await credentialStore.load(profile.target.passwordCredentialKey)
        : null;
      const passphrase = profile.target.privateKeyPassphraseCredentialKey
        ? await credentialStore.load(profile.target.privateKeyPassphraseCredentialKey)
        : null;
      return {
        profile,
        publicProfile: toPublicProfile(profile),
        password: password ?? undefined,
        passphrase: passphrase ?? undefined,
      };
    },

    async saveProfile(input) {
      return mutate(async (state) => {
        const isUpdate = Boolean(input.profileId);
        const existingIndex = isUpdate
          ? state.profiles.findIndex((p) => p.profileId === input.profileId)
          : -1;
        if (isUpdate && existingIndex === -1) {
          throw new Error("Server profile not found.");
        }

        const profileId = isUpdate ? input.profileId : randomUUID();
        const existing = existingIndex >= 0 ? state.profiles[existingIndex] : null;
        const passKey = credentialKey(profileId, "password");
        const phraseKey = credentialKey(profileId, "private-key-passphrase");

        let passwordCredentialKey = existing?.target.passwordCredentialKey;
        let privateKeyPassphraseCredentialKey = existing?.target.privateKeyPassphraseCredentialKey;

        if (input.authType === "password") {
          if (input.password && input.password.length > 0) {
            await credentialStore.save(passKey, input.password);
            passwordCredentialKey = passKey;
          }
          if (privateKeyPassphraseCredentialKey) {
            await credentialStore.delete(privateKeyPassphraseCredentialKey);
            privateKeyPassphraseCredentialKey = undefined;
          }
        } else {
          if (input.passphrase && input.passphrase.length > 0) {
            await credentialStore.save(phraseKey, input.passphrase);
            privateKeyPassphraseCredentialKey = phraseKey;
          } else if (input.clearPassphrase && privateKeyPassphraseCredentialKey) {
            await credentialStore.delete(privateKeyPassphraseCredentialKey);
            privateKeyPassphraseCredentialKey = undefined;
          }
          if (passwordCredentialKey) {
            await credentialStore.delete(passwordCredentialKey);
            passwordCredentialKey = undefined;
          }
        }

        const target = {
          kind: "ssh",
          host: input.host.trim(),
          port: input.port ?? 22,
          username: input.username.trim(),
          ...(input.authType === "privateKey" && input.privateKeyPath?.trim()
            ? { privateKeyPath: input.privateKeyPath.trim() }
            : {}),
          ...(passwordCredentialKey ? { passwordCredentialKey } : {}),
          ...(privateKeyPassphraseCredentialKey ? { privateKeyPassphraseCredentialKey } : {}),
        };

        const record = {
          profileId,
          transport: "ssh",
          displayName: input.displayName?.trim() || undefined,
          target,
          createdAt: existing?.createdAt ?? Date.now(),
          lastConnectedAt: existing?.lastConnectedAt,
          lastConnectError: existing?.lastConnectError,
        };

        if (existingIndex >= 0) {
          state.profiles[existingIndex] = record;
        } else {
          state.profiles.push(record);
        }

        return toPublicProfile(record);
      });
    },

    async deleteProfile(profileId) {
      return mutate(async (state) => {
        const index = state.profiles.findIndex((p) => p.profileId === profileId);
        if (index === -1) throw new Error("Server profile not found.");
        const [removed] = state.profiles.splice(index, 1);
        state.selectedIds = state.selectedIds.filter((id) => id !== profileId);
        if (removed.target.passwordCredentialKey) {
          await credentialStore.delete(removed.target.passwordCredentialKey).catch(() => {});
        }
        if (removed.target.privateKeyPassphraseCredentialKey) {
          await credentialStore
            .delete(removed.target.privateKeyPassphraseCredentialKey)
            .catch(() => {});
        }
        return { deletedId: profileId };
      });
    },

    async setSelectedIds(serverIds) {
      return mutate(async (state) => {
        const validSet = new Set(state.profiles.map((p) => p.profileId));
        for (const id of serverIds) {
          if (!validSet.has(id)) {
            throw new Error(`Server profile "${id}" no longer exists.`);
          }
        }
        state.selectedIds = [...new Set(serverIds)];
        return state.selectedIds;
      });
    },

    async recordConnectResult(profileId, { ok, error }) {
      return mutate(async (state) => {
        const profile = state.profiles.find((p) => p.profileId === profileId);
        if (!profile) return;
        if (ok) {
          profile.lastConnectedAt = Date.now();
          delete profile.lastConnectError;
        } else {
          profile.lastConnectError = error || "Connection failed.";
        }
      });
    },
  };
}
