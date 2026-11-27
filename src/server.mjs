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
import { execRemote, uploadRemote } from "./ssh-backend.mjs";
import { loadSshProfiles } from "./ssh-config.mjs";
import { createBindingsStore } from "./store.mjs";

const PICKER_URI = "ui://server-ops/picker.html";
const VERSION = "0.1.0";

const resource = {
  uri: PICKER_URI,
  name: "Server picker",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: { prefersBorder: false },
  },
};

const stringSchema = { type: "string" };

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
  defineTool("open_server_picker", "Show the interactive SSH server picker to authorize hosts.", {}, [], {
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
  }),
  defineTool("picker_read", "Read SSH host profiles from ~/.ssh/config and current authorization.", {}, [], {
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
    sshConfigPath: process.env.SERVER_OPS_SSH_CONFIG || join(homedir(), ".ssh", "config"),
    workspaceDir: process.env.SERVER_OPS_WORKSPACE || "",
  };
  for (const arg of argv) {
    if (arg.startsWith("--data-dir=")) options.dataDir = arg.slice("--data-dir=".length);
    else if (arg.startsWith("--ssh-config=")) options.sshConfigPath = arg.slice("--ssh-config=".length);
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
  const store = createBindingsStore(join(options.dataDir, "bindings.json"));

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
        const profiles = await loadSshProfiles(options.sshConfigPath);
        const savedIds = await store.readIds();
        const validIds = savedIds.filter((id) => profiles.some((p) => p.id === id));
        return {
          content: [
            {
              type: "text",
              text:
                validIds.length > 0
                  ? `Server picker opened. Currently authorized: ${validIds.join(", ")}.`
                  : "Server picker opened. Select one or more SSH hosts to authorize them.",
            },
          ],
          structuredContent: { profiles, serverIds: validIds },
        };
      }

      const profiles = await loadSshProfiles(options.sshConfigPath);
      const savedIds = await store.readIds();
      const selectedProfiles = profiles.filter((p) => savedIds.includes(p.id));

      if (params.name === "picker_read") {
        const payload = {
          profiles,
          serverIds: selectedProfiles.map((p) => p.id),
        };
        return {
          content: [{ type: "text", text: "Server selection" }],
          structuredContent: payload,
        };
      }

      if (params.name === "picker_save") {
        const { serverIds } = pickerSaveSchema.parse(params.arguments ?? {});
        const validSet = new Set(profiles.map((p) => p.id));
        for (const id of serverIds) {
          if (!validSet.has(id)) {
            throw new Error(`SSH host "${id}" was not found in SSH config.`);
          }
        }
        const saved = await store.writeIds(serverIds);
        return {
          content: [{ type: "text", text: "Server selection saved" }],
          structuredContent: { serverIds: saved },
        };
      }

      if (params.name === "server_list") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ servers: selectedProfiles }),
            },
          ],
        };
      }

      if (params.name === "remote_run") {
        const { serverId, command } = remoteRunSchema.parse(params.arguments ?? {});
        const profile = selectedProfiles.find((p) => p.id === serverId);
        if (!profile) {
          throw new Error(
            `SSH host "${serverId}" is not authorized. Open the server picker and select it first.`,
          );
        }
        const result = await execRemote(profile.id, command, {
          signal: extra.signal,
          sshConfigPath: options.sshConfigPath,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ server: profile, ...result }) }],
        };
      }

      if (params.name === "server_copy") {
        const args = serverCopySchema.parse(params.arguments ?? {});
        const profile = selectedProfiles.find((p) => p.id === args.serverId);
        if (!profile) {
          throw new Error(
            `SSH host "${args.serverId}" is not authorized. Open the server picker and select it first.`,
          );
        }
        const localPath = await resolveUploadSource(args.source, options.workspaceDir);
        const result = await uploadRemote(profile.id, localPath, args.destination, {
          overwrite: args.overwrite,
          signal: extra.signal,
          sshConfigPath: options.sshConfigPath,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ server: profile, ...result }) }],
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
