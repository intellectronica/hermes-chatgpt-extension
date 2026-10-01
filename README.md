# Hermes for Codex

An MCP plugin that brings [Hermes Agent](https://github.com/NousResearch/hermes-agent) into Codex as an embedded chat app. Connect to local or remote Hermes instances, work with their profiles and conversations, and inspect scheduled jobs without leaving Codex.

The interface follows Codex's chat and sidebar conventions and inherits the host's light/dark theme. Hermes runs the agent, tools, memory and scheduler; the surrounding Codex conversation remains separate.

## What it does

- Streams replies, renders Markdown and code, shows tool activity, and supports Stop, approvals and clarification questions.
- Groups conversations under expandable profile sections with Hermes avatars. Drafts stay with their owning instance and profile.
- Uses each profile's real model catalogue and defaults, with a model selector and Power control for reasoning effort.
- Shows scheduled jobs and recorded runs for one profile or all profiles. Schedule, execution and delivery status are shown separately.
- Archives conversations through Hermes, with a brief **Undo** action. Archiving retains the stored messages.

Upstream credentials stay in the local bridge process. The embedded interface receives connection labels and chat data, rather than tokens or provider credentials.

## Requirements

- **Node.js 22 or later**, available to Codex as `node`. A source build also needs npm.
- A Codex desktop version that supports local plugins and MCP Apps. The installer registers a local marketplace entry; public Plugins Directory publication is a separate process.
- An installed, configured Hermes backend with the desktop JSON-RPC/WebSocket API and REST management routes. See [connection configuration](#connection-configuration).
- For SSH connections, a local `ssh` client, an accepted host key and non-interactive authentication through your SSH configuration or agent. Managed SSH also needs a POSIX remote host, `python3` on its PATH and a Hermes installation with its server dependencies.

This package provides a local stdio MCP server. It does not provide a hosted MCP endpoint for ChatGPT cloud access.

## Install

### From a prebuilt ZIP

Extract the provided release ZIP and open a terminal in the extracted directory containing `plugin.json`.

```sh
node scripts/verify-plugin.mjs
```

The ZIP includes the compiled server and self-contained UI. It needs Node.js, without an npm install or build. Continue with **Configure and register the plugin** below.

### From source

Extract the source ZIP and open its directory containing `package.json`. Alternatively, with access to the Git repository:

```sh
git clone https://github.com/intellectronica/hermes-chatgpt-extension.git
cd hermes-chatgpt-extension
```

Build the source:

```sh
npm ci
npm run build
node scripts/verify-plugin.mjs
```

Continue with the same configuration and installation steps. A raw Git checkout needs this build before Codex can load the plugin.

### Configure and register the plugin

Keep your connection configuration outside the plugin directory so updates preserve it. Start with the example for your connection mode:

```sh
mkdir -p "$HOME/.config/hermes-chatgpt-extension"
cp examples/config.ssh.json "$HOME/.config/hermes-chatgpt-extension/hermes.config.json"
```

Edit that file for your Hermes host and installation paths. For other modes, use the examples in [connection configuration](#connection-configuration). Preview the installation, then apply it:

```sh
node scripts/install-plugin.mjs --config "$HOME/.config/hermes-chatgpt-extension/hermes.config.json" --dry-run
node scripts/install-plugin.mjs --config "$HOME/.config/hermes-chatgpt-extension/hermes.config.json" --apply
```

The installer copies the plugin into `~/.codex/plugins/hermes-chatgpt-extension` and adds its entry to `~/.agents/plugins/marketplace.json`. It preserves an existing marketplace name and unrelated entries. It records the configuration file's absolute path; it does not copy its contents.

Open the plugin detail link printed by the installer and choose **Install** or **Enable** in Codex. If your local source is not yet listed, restart the desktop app, open the Plugins Directory and select the marketplace named by the installer. A new marketplace is called **Personal plugins**; an existing one keeps its name. The script does not enable the plugin or restart Codex itself. These local-marketplace steps follow [OpenAI's plugin packaging guidance](https://developers.openai.com/plugins/build/plugins).

### Update an installed copy

Build the new source checkout or extract the new ZIP, then run:

```sh
node scripts/install-plugin.mjs --replace --dry-run
node scripts/install-plugin.mjs --replace --apply
```

Replacement retains backups and preserves the previous configuration reference. To change that reference, add `--config /absolute/path/to/hermes.config.json`. Refresh the installed plugin in Codex or restart the desktop app so its MCP connection and cached UI load the new files.

## Connection configuration

A configuration contains a `connections` array. Each entry needs a unique `id`, a display `label` and its connection settings. Add several entries to connect multiple Hermes instances; the footer selector switches between them. Profiles are discovered from Hermes rather than enumerated in this file.

Configuration is loaded in this order:

1. The `--config` argument, if supplied.
2. `HERMES_EXTENSION_CONFIG`, if set.
3. `hermes.config.json` in the bridge's working directory.
4. `$XDG_CONFIG_HOME/hermes-chatgpt-extension/hermes.config.json` when `XDG_CONFIG_HOME` is an absolute path; otherwise `~/.config/hermes-chatgpt-extension/hermes.config.json`.

An explicitly selected missing file, or any selected invalid file, is an error; discovery does not skip invalid configuration. With no configuration file, the app opens with no connections. Relative configuration paths are resolved from the working directory; relative `tokenFile` paths are resolved from the configuration file's directory. Local paths can use `~/`.

### Managed SSH

Use this mode when Hermes is installed remotely and the extension should start its own temporary backend:

```json
{
  "connections": [
    {
      "id": "remote",
      "label": "Remote Hermes",
      "kind": "ssh",
      "ssh": {
        "host": "hermes-host",
        "mode": "managed"
      }
    }
  ]
}
```

`host` can be an SSH-config alias or hostname. Optional `user` and `port` select the SSH account and port. Defaults are `~/.hermes` for `hermesHome` and `<hermesHome>/hermes-agent` for `repoPath`; the bridge looks for `venv/bin/python`, then `.venv/bin/python`, in that repository. Set `pythonPath` for another existing runtime. These remote paths must be absolute or start with `~/`, relative to the SSH user. [Managed SSH example](examples/config.ssh.json).

The bridge starts a token-protected loopback backend on a dynamically allocated port and owns that process and its SSH tunnel. It stops its backend when the bridge closes. It uses the existing Hermes installation and does not install software, edit profiles or restart services. Its temporary backend does not start the desktop cron scheduler; **Scheduled** reads the jobs and run records maintained by Hermes.

Check SSH access before using the plugin:

```sh
ssh -o BatchMode=yes hermes-host true
```

Managed mode generates its own credential. Do not specify `tokenEnv`, `tokenFile`, `remoteHost` or `remotePort` for it.

### Attach over SSH

Use this mode to connect to an already-running, compatible Hermes desktop backend bound to remote loopback:

```json
{
  "connections": [
    {
      "id": "attached",
      "label": "Existing Hermes",
      "kind": "ssh",
      "tokenFile": "./hermes.token",
      "ssh": {
        "host": "hermes-host",
        "mode": "attach",
        "remotePort": 9119
      }
    }
  ]
}
```

`remotePort` must be the backend's actual port. `remoteHost` defaults to `127.0.0.1` and must remain a loopback address. The bridge forwards it through SSH and leaves the existing backend running when it closes. `tokenFile` is a local file containing that backend's credential, not a remote path. Attach mode cannot include the managed-only `hermesHome`, `repoPath` or `pythonPath` settings. [SSH attach example](examples/config.ssh-attach.json).

### HTTP or HTTPS gateway

Use a compatible Hermes desktop gateway directly:

```json
{
  "connections": [
    {
      "id": "gateway",
      "label": "Hermes gateway",
      "kind": "http",
      "baseUrl": "https://hermes.example.com/hermes",
      "tokenEnv": "HERMES_GATEWAY_TOKEN"
    }
  ]
}
```

Use a compatible `hermes serve` desktop backend. It must expose JSON-RPC over `/api/ws` and the corresponding REST routes for profiles, sessions and cron data. Hermes's messaging gateway, an OpenAI-compatible `/v1` endpoint or a generic HTTP chat API alone is insufficient. A reverse proxy must forward WebSocket upgrades and preserve the configured path prefix. See [Hermes's programmatic integration guide](https://github.com/NousResearch/hermes-agent/blob/44a1ce9724502b9c692faaef00af3054bf11f1a6/website/docs/developer-guide/programmatic-integration.md) for the separate protocols.

`baseUrl` is the gateway root, optionally with a path prefix, without `/api/ws`, embedded credentials, a query or a fragment. Remote URLs require HTTPS. Plain HTTP is accepted only for loopback hosts such as `http://127.0.0.1:9119`. [HTTPS example](examples/config.http.json), [local HTTP example](examples/config.local.json).

### Credentials and multiple instances

HTTP and SSH attach require exactly one credential source:

- `tokenEnv`: the name of an environment variable available to the bridge process.
- `tokenFile`: a small local text file containing the credential, with surrounding whitespace ignored. On POSIX systems, it must belong to the current user and have owner-only permissions, for example `chmod 600 /path/to/hermes.token`.

A desktop app may not inherit variables exported in an interactive shell. A private `tokenFile` is useful when the plugin is launched by Codex. Use the credential accepted by the Hermes desktop backend. A public dashboard needs a session access token from its configured authentication provider, accepted for both REST and WebSocket access. Provider API keys are configured in Hermes, not in this plugin. Keep token files and your populated configuration outside the distributable package and source control.

Combine any supported modes in one `connections` array. Each instance has its own connection and credential; use distinct IDs even when labels are similar. See [multiple-instance example](examples/config.multiple.json).

An optional connection-level `cwd` sets the working directory for new Hermes conversations. It is a path on the Hermes host, so use a remote path for SSH connections. To show Hermes-tagged automated conversations, add `"sidebar": { "showAutomatedChats": true }` alongside `connections`; they are hidden by default. Hermes's own subagent visibility setting still applies.

## Open and use Hermes

After installation and enabling:

- **Sidebar app:** open **Explore → Hermes**. Hover its entry and choose **Pin to sidebar** to keep it available. Some desktop versions expose pinning under **Explore → Customize**.
- **Tab in a Codex chat:** choose **New tab (+) → More tools… → Plugins and MCPs → Hermes**.
- **Inline app:** ask Codex to open Hermes, then expand the returned app panel.

Opening the app does not send a Hermes prompt. Choose an instance in the sidebar footer; the connection indicator appears beneath its name. Expand a profile section to see its chats, select a conversation, or use the profile's **New chat** control. Switching profiles preserves their drafts and does not change Hermes's machine-wide default profile.

Type in the Hermes composer. **Enter** sends; **Shift+Enter** adds a newline. **Stop** interrupts an active Hermes turn. Answer any displayed approval or clarification card to let Hermes continue. Tool activity can be expanded to inspect the available input and output.

The composer control beside Send shows the model and reasoning effort. Open it to adjust **Power**, or click the selected model row to choose from Hermes's available models. Left/Right adjusts effort and Enter closes the picker. New chats inherit profile defaults; explicit choices affect the selected conversation. **Reset to default** applies the current profile defaults to that conversation. Required Hermes model confirmations must be accepted before a guarded change takes effect. Supported reasoning options depend on the model, and Hermes maps effort to the provider's capabilities.

Select **Scheduled** to view jobs for the selected profile or all profiles, their schedules and recorded runs. Timestamps use your browser's local timezone, while each job retains its schedule timezone. Missing execution, delivery or scheduler evidence is shown as unknown. This view cannot create, edit or run jobs.

Hover a chat row, or focus it with the keyboard, to reveal **Archive chat**. The row disappears after Hermes confirms the archive. **Undo** restores the same conversation and its history. Archiving is unavailable while that conversation is busy, has an unanswered question, awaits a model confirmation or has an uncertain operation. There is no archived-chat browser in this version; later restoration can use Hermes's own interface.

### Standalone local preview

The same app can run in a browser for development or use outside the embedded panel:

```sh
node dist/server.cjs --http --config /absolute/path/to/hermes.config.json
```

Open the loopback URL printed by the server, normally `http://127.0.0.1:4318`. Use `--port 4320` to choose another port. The preview uses a same-origin HttpOnly cookie and validates Host/Origin; upstream credentials remain in the bridge. It is a local interface, not a public web deployment.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Hermes is missing from Codex | Apply the installer, open its printed detail link and install/enable the plugin. Restart the desktop app if the local marketplace has not been discovered. |
| No instances appear | Check configuration discovery or install with an explicit `--config` path. Verify the JSON and unique connection IDs. |
| Codex cannot start the MCP server | Ensure Node.js 22+ is available as `node` to the desktop app. A source checkout must be built; the ZIP already contains `dist/`. |
| SSH cannot connect | Test batch-mode SSH with the same host/user/port. Check the SSH agent, accepted host key and remote permissions. |
| Managed Hermes does not start | Check the remote repository/interpreter paths, `python3` on PATH and Hermes server dependencies. Initial startup may take longer than attaching to an existing backend. |
| Authentication fails | Verify the credential belongs to the attached backend, the environment variable reaches the bridge, or the token file is readable, private and non-empty. |
| HTTP connects but chat or management fails | Verify this is the Hermes desktop gateway, its version supports the required APIs, and the proxy forwards both WebSockets and REST routes. |
| An older interface remains after updating | Refresh the installed plugin or restart Codex to restart its MCP connection and reload the cached UI. Replacing source files alone does not update an existing panel. |
| A send has an unknown outcome | Reconnect and inspect the original conversation. Do not assume the message failed: the bridge never automatically resends a prompt after a lost acknowledgement. |
| Model selection changes after a backend restart | Hermes's safe history resume may use current profile defaults rather than restoring old runtime-only overrides. Check the displayed authoritative model and select it again if needed. |
| Scheduled delivery or execution is unknown | The backend has not supplied that evidence. Opening the view does not run jobs, start a scheduler or repair delivery. |
| Archive fails or Undo is unavailable | A failed acknowledgement leaves the row visible. Wait for a busy conversation to finish; use Hermes's own interface to restore an older archive after the brief Undo action expires. |

## Scope and limitations

- Codex hosts the app through MCP Apps; the plugin does not replace Codex's native agent runtime. Host versions and account policies can affect discovery and available panel routes.
- Hermes's desktop APIs are the compatibility boundary. There is no universal Hermes version guarantee or adapter for arbitrary chat gateways.
- Standard chat, tools, approvals and clarification are supported. Desktop-only file, browser, secret, sudo and vault peer operations are not implemented.
- Reconnecting to the same live backend differs from restarting it. Stored history can be reloaded safely, but in-flight work and conversation-only model settings are not guaranteed to survive a backend restart.
- History, conversation lists, tool output and job records are bounded. The sidebar is a recent-conversation view, not an exhaustive export.
- The embedded app controls are intended for a trusted local MCP host. UI-only MCP metadata and tool visibility keep transcript data out of ordinary model-facing results; they are not a separate authentication boundary.

## Development

```sh
npm run check
npm test
npm run build
npm run plugin:verify -- --probe
```

Build shareable archives and verify their fresh-user installation:

```sh
npm run release:package
npm run release:verify
```

This creates a prebuilt plugin ZIP, a source ZIP and `SHA256SUMS` under `release/`. Both ZIPs contain only allowlisted files and an integrity manifest; they exclude Git history, private configuration, tokens, logs and local development outputs. Use the source ZIP to initialise a new repository with clean history when needed.

The verifier checks packaging and can probe MCP initialization, entrypoints and UI resources without sending a Hermes prompt. Live Hermes integration tests are opt-in. Frontend code lives in `src/web`, the MCP/local HTTP bridge in `src/bridge`, and the Hermes protocol adapter in `src/hermes`.

## Licence

This extension is released under the [MIT licence](LICENSE). Its [repository](https://github.com/intellectronica/hermes-chatgpt-extension) is maintained by intellectronica. A local installation or shared ZIP does not imply publication or approval in OpenAI's public Plugins Directory.

Hermes brand assets and other bundled components retain their upstream licences. See [third-party notices](THIRD_PARTY_NOTICES.md) and the generated `dist/THIRD_PARTY_LICENSES.txt` included with the built package. This project is an independent integration and is not an OpenAI or Nous Research product.
