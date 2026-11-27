# antigravity-server-ops

An open-source **MCP Server + MCP App Plugin** for **Google Antigravity** and standard MCP clients.

Manage SSH servers directly inside an Antigravity-styled UI with **ZCode-style separated metadata + encrypted credential storage** (no `~/.ssh/config` dependency), authorize specific servers for the agent, execute remote commands, and atomically upload files.

## Quick Start (One-Command Install via `npx`)

```bash
npx -y antigravity-server-ops init
```

That's it! It installs the plugin into `~/.gemini/config/plugins/server-ops` and Antigravity discovers it automatically without restarting.

To uninstall:

```bash
npx -y antigravity-server-ops uninstall
```

## Features

- **Antigravity-Native MCP App UI (`@modelcontextprotocol/ext-apps`)**: Add, edit, delete, test SSH connectivity, and toggle server authorization in Antigravity's full-page view (`global`), side pane (`aux_pane`), or inline chat card.
- **Separated Profile & Encrypted Credential Storage**:
  - Non-sensitive profile metadata (`host`, `port`, `username`, `displayName`, `privateKeyPath`) is stored in `${PLUGIN_DATA}/profiles.json`.
  - Passwords and private key passphrases are stored separately in the **macOS Login Keychain** (with `AES-256-GCM` encrypted vault fallback on Linux/Windows) and are never exposed to the LLM or UI.
- **Built-in Pure-JS SSH & SFTP Engine (`ssh2`)**: Supports password auth and private key + passphrase auth without modifying or depending on OS `~/.ssh/config`.
- **Safe Remote Operations**:
  - `open_server_picker`: Opens the Server Ops UI.
  - `server_list`: Lists currently authorized servers.
  - `remote_run`: Executes a shell command on an authorized server (32 KiB output cap, timeout & cancellation support).
  - `server_copy`: Uploads a local file via SFTP to a remote temporary staging file and atomically publishes it (`replace` / `skip` / `error`) with automatic cleanup on failure.

## Use with Other MCP Clients

```json
{
  "mcpServers": {
    "server-ops": {
      "command": "npx",
      "args": ["-y", "antigravity-server-ops"]
    }
  }
}
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
