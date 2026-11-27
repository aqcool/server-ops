import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createCredentialStore } from "./credential-store.mjs";
import { createProfileStore } from "./profile-store.mjs";
import { execRemote, testConnection, uploadRemote } from "./ssh-backend.mjs";

const PICKER_URI = "ui://server-ops/picker.html";
const VERSION = "0.2.0";

const resource = {
  uri: PICKER_URI,
  name: "Server Ops",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: { prefersBorder: false },
  },
};

const stringSchema = { type: "string" };
const numberSchema = { type: "number" };
const booleanSchema = { type: "boolean" };

function defineTool(name, description, properties = {}, required = [], options = {}) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    ...options,
  };
}

const appOnly = { _meta: { ui: { visibility: ["app"] } } };
const readOnly = { annotations: { readOnlyHint: true } };

const tools = [
  defineTool(
    "open_server_picker",
    "Show the SSH server manager and picker to add, test, or authorize servers.",
    {},
    [],
    {
      ...readOnly,
      _meta: {
        ui: { resourceUri: PICKER_URI },
        "com.google.antigravity/ui": {
          entrypoints: [
            { type: "aux_pane", title: "Server Ops" },
            { type: "global", title: "Server Ops" },
          ],
        },
      },
    },
  ),
  defineTool("picker_read", "Read saved SSH server profiles and current authorization.", {}, [], {
    ...appOnly,
    ...readOnly,
  }),
  defineTool(
    "picker_save",
    "Save the user's authorized SSH server selection.",
    {
      serverIds: { type: "array", items: stringSchema },
    },
    ["serverIds"],
    appOnly,
  ),
  defineTool(
    "profile_save",
    "Create or update a saved SSH server profile.",
    {
      profileId: stringSchema,
      displayName: stringSchema,
      host: stringSchema,
      port: numberSchema,
      username: stringSchema,
      authType: { type: "string", enum: ["password", "privateKey"] },
      password: stringSchema,
      privateKeyPath: stringSchema,
      passphrase: stringSchema,
      clearPassphrase: booleanSchema,
    },
    ["host", "username", "authType"],
    appOnly,
  ),
  defineTool(
    "profile_delete",
    "Delete a saved SSH server profile and its stored credentials.",
    {
      profileId: stringSchema,
    },
    ["profileId"],
    appOnly,
  ),
  defineTool(
    "profile_test",
    "Test SSH connectivity for a saved profile.",
    {
      profileId: stringSchema,
    },
    ["profileId"],
    appOnly,
  ),
  defineTool("server_list", "List the SSH servers currently authorized by the user.", {}, [], readOnly),
  defineTool(
    "remote_run",
    "Run a shell command on an authorized SSH server.",
    {
      serverId: stringSchema,
      command: stringSchema,
    },
    ["serverId", "command"],
    { annotations: { destructiveHint: true } },
  ),
  defineTool(
    "server_copy",
    "Upload a local file to an exact absolute destination on an authorized SSH server.",
    {
      serverId: stringSchema,
      source: stringSchema,
      destination: stringSchema,
      overwrite: { type: "string", enum: ["replace", "skip", "error"] },
    },
    ["serverId", "source", "destination"],
    { annotations: { destructiveHint: true } },
  ),
];

const pickerSaveSchema = z.object({ serverIds: z.array(z.string().min(1)) });
const profileSaveSchema = z.object({
  profileId: z.string().min(1).optional(),
  displayName: z.string().optional(),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1),
  authType: z.enum(["password", "privateKey"]),
  password: z.string().optional(),
  privateKeyPath: z.string().optional(),
  passphrase: z.string().optional(),
  clearPassphrase: z.boolean().optional(),
});
const profileIdSchema = z.object({ profileId: z.string().min(1) });
const remoteRunSchema = z.object({
  serverId: z.string().min(1),
  command: z.string().trim().min(1).max(16_384),
});
const serverCopySchema = z.object({
  serverId: z.string().min(1),
  source: z.string().min(1),
  destination: z.string().min(1),
  overwrite: z.enum(["replace", "skip", "error"]).default("error"),
});

function parseCliArgs(argv) {
  const options = {
    dataDir: process.env.SERVER_OPS_DATA_DIR || join(homedir(), ".config", "server-ops"),
    workspaceDir: process.env.SERVER_OPS_WORKSPACE || "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--data-dir=")) options.dataDir = arg.slice("--data-dir=".length);
    else if (arg.startsWith("--workspace=")) options.workspaceDir = arg.slice("--workspace=".length);
  }
  return options;
}

async function resolveUploadSource(sourceInput, workspaceDir) {
  if (workspaceDir) {
    const workspace = await realpath(workspaceDir);
    const source = await realpath(resolve(workspace, sourceInput));
    const within = relative(workspace, source);
    if (
      within === ".." ||
      within.startsWith(`..${sep}`) ||
      isAbsolute(within) ||
      !(await stat(source)).isFile()
    ) {
      throw new Error("Choose a file inside the configured workspace.");
    }
    return source;
  }

  const candidate = isAbsolute(sourceInput) ? sourceInput : resolve(process.cwd(), sourceInput);
  const resolved = await realpath(candidate);
  if (!(await stat(resolved)).isFile()) {
    throw new Error("Source path must be an existing file.");
  }
  return resolved;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const credentialStore = createCredentialStore(options.dataDir);
  const profileStore = createProfileStore(options.dataDir, credentialStore);

  const server = new Server(
    { name: "server-ops", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [resource] }));

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri !== PICKER_URI) throw new Error("Unknown resource.");
    const htmlPath = process.env.SERVER_OPS_PICKER_HTML
      ? resolve(process.env.SERVER_OPS_PICKER_HTML)
      : new URL("./picker.html", import.meta.url);
    const text = await readFile(htmlPath, "utf8");
    return { contents: [{ ...resource, text }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    try {
      if (!tools.some((entry) => entry.name === params.name)) {
        throw new Error("Unknown server-ops tool.");
      }

      if (params.name === "open_server_picker") {
        const snap = await profileStore.snapshot();
        const selectedNames = snap.profiles
          .filter((p) => snap.serverIds.includes(p.id))
          .map((p) => p.name);
        return {
          content: [
            {
              type: "text",
              text:
                selectedNames.length > 0
                  ? `Server Ops opened. Authorized servers: ${selectedNames.join(", ")}.`
                  : "Server Ops opened. Add or select SSH servers to authorize them.",
            },
          ],
          structuredContent: snap,
        };
      }

      if (params.name === "picker_read") {
        const snap = await profileStore.snapshot();
        return {
          content: [{ type: "text", text: "Server profiles loaded." }],
          structuredContent: snap,
        };
      }

      if (params.name === "picker_save") {
        const { serverIds } = pickerSaveSchema.parse(params.arguments ?? {});
        const saved = await profileStore.setSelectedIds(serverIds);
        return {
          content: [{ type: "text", text: "Server authorization saved." }],
          structuredContent: { serverIds: saved },
        };
      }

      if (params.name === "profile_save") {
        const input = profileSaveSchema.parse(params.arguments ?? {});
        const savedProfile = await profileStore.saveProfile(input);
        const snap = await profileStore.snapshot();
        return {
          content: [{ type: "text", text: `Saved server ${savedProfile.name}.` }],
          structuredContent: { profile: savedProfile, ...snap },
        };
      }

      if (params.name === "profile_delete") {
        const { profileId } = profileIdSchema.parse(params.arguments ?? {});
        await profileStore.deleteProfile(profileId);
        const snap = await profileStore.snapshot();
        return {
          content: [{ type: "text", text: "Deleted server profile." }],
          structuredContent: snap,
        };
      }

      if (params.name === "profile_test") {
        const { profileId } = profileIdSchema.parse(params.arguments ?? {});
        const conn = await profileStore.getProfileWithSecrets(profileId);
        if (!conn) throw new Error("Server profile not found.");
        try {
          const result = await testConnection(conn, { signal: extra.signal });
          await profileStore.recordConnectResult(profileId, { ok: result.ok });
          const snap = await profileStore.snapshot();
          return {
            content: [{ type: "text", text: result.info }],
            structuredContent: { ok: result.ok, info: result.info, ...snap },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await profileStore.recordConnectResult(profileId, { ok: false, error: message });
          const snap = await profileStore.snapshot();
          return {
            content: [{ type: "text", text: message }],
            structuredContent: { ok: false, error: message, ...snap },
          };
        }
      }

      if (params.name === "server_list") {
        const snap = await profileStore.snapshot();
        const selected = snap.profiles
          .filter((p) => snap.serverIds.includes(p.id))
          .map((p) => ({ id: p.id, name: p.name, subtitle: p.subtitle }));
        return {
          content: [{ type: "text", text: JSON.stringify({ servers: selected }) }],
        };
      }

      if (params.name === "remote_run") {
        const { serverId, command } = remoteRunSchema.parse(params.arguments ?? {});
        const snap = await profileStore.snapshot();
        if (!snap.serverIds.includes(serverId)) {
          throw new Error(
            "This SSH server is not authorized. Open Server Ops and authorize it first.",
          );
        }
        const conn = await profileStore.getProfileWithSecrets(serverId);
        if (!conn) throw new Error("Server profile no longer exists.");
        const result = await execRemote(conn, command, { signal: extra.signal });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                server: { id: conn.publicProfile.id, name: conn.publicProfile.name },
                ...result,
              }),
            },
          ],
        };
      }

      if (params.name === "server_copy") {
        const args = serverCopySchema.parse(params.arguments ?? {});
        const snap = await profileStore.snapshot();
        if (!snap.serverIds.includes(args.serverId)) {
          throw new Error(
            "This SSH server is not authorized. Open Server Ops and authorize it first.",
          );
        }
        const conn = await profileStore.getProfileWithSecrets(args.serverId);
        if (!conn) throw new Error("Server profile no longer exists.");
        const localPath = await resolveUploadSource(args.source, options.workspaceDir);
        const result = await uploadRemote(conn, localPath, args.destination, {
          overwrite: args.overwrite,
          signal: extra.signal,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                server: { id: conn.publicProfile.id, name: conn.publicProfile.name },
                ...result,
              }),
            },
          ],
        };
      }

      throw new Error("Unhandled server-ops tool.");
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}
