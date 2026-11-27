# server-ops

An open-source **MCP Server + MCP App Plugin** for **Google Antigravity** and standard MCP clients.

It lets you authorize specific SSH hosts from `~/.ssh/config` via an interactive MCP App picker UI, then lets the agent run remote shell commands and atomically upload local files only on the hosts you explicitly checked.

## Features

- **Interactive MCP App UI (`@modelcontextprotocol/ext-apps`)**: Check/uncheck SSH hosts directly inside chat (inline) or in Antigravity's side pane (`aux_pane`) / left sidebar (`global`).
- **Least-Privilege Host Authorization**: The model only sees hosts you explicitly selected (`server_list`); SSH keys and credentials stay in your local SSH client / `ssh-agent`.
- **Zero-Config `~/.ssh/config` Discovery**: Automatically parses concrete `Host` aliases (including `Include` directives), skipping wildcard entries.
- **Safe Remote Operations**:
  - `open_server_picker`: Opens the interactive server picker UI.
  - `server_list`: Lists currently authorized servers.
  - `remote_run`: Executes a shell command on an authorized server (32 KiB output cap, timeout & cancellation support).
  - `server_copy`: Uploads a local file to a remote temporary staging file and atomically publishes it (`replace` / `skip` / `error`) with automatic cleanup on failure.

## Install as an Antigravity Plugin

Because `dist/` is pre-bundled with zero runtime dependencies, you can clone directly into Antigravity's global plugins directory:

```bash
git clone https://github.com/aqcool/server-ops.git ~/.gemini/config/plugins/server-ops
```

Antigravity automatically discovers `plugin.json`, `mcp_config.json`, and `skills/server-ops/SKILL.md`.

## Use with Other MCP Clients

Add to your MCP config (e.g., Claude Desktop / Cursor):

```json
{
  "mcpServers": {
    "server-ops": {
      "command": "node",
      "args": ["/path/to/server-ops/dist/server.mjs"]
    }
  }
}
```

### CLI Options / Environment Variables

- `--data-dir=<path>` / `SERVER_OPS_DATA_DIR`: Directory for persisting authorized host selections (defaults to `~/.config/server-ops`).
- `--ssh-config=<path>` / `SERVER_OPS_SSH_CONFIG`: Path to SSH config file (defaults to `~/.ssh/config`).
- `--workspace=<path>` / `SERVER_OPS_WORKSPACE`: Optional workspace root to confine `server_copy` source paths.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
