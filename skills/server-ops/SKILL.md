---
name: server-ops
description: Inspect logs and services, execute shell commands, and upload local files to SSH servers explicitly authorized by the user.
---

Call `server_list` first to see the SSH servers currently authorized by the user. If no server is selected or the target server is missing/ambiguous, call `open_server_picker` so the user can add or check the servers they want to authorize.

Use the returned server `id` with `remote_run` or `server_copy`. Keep commands scoped to the task. Use an absolute destination file path on the remote server for uploads. Summarize command results and errors clearly, including the exit code when available. Never ask the user to paste SSH passwords or private key passphrases into chat; credentials are managed directly inside the Server Ops UI and stored encrypted locally.
