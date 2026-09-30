# Hermes ChatGPT Extension

A private MCP app and Codex plugin for working with local or remote [Hermes](https://github.com/NousResearch/hermes-agent).

The first release provides a familiar chat interface, profile switching and cron inspection. Hermes remains the agent runtime; the extension supplies the interface and connection bridge.

## First version

- A familiar ChatGPT/Codex layout, with light/dark themes, a conversation rail, Markdown, a multiline composer and a mobile drawer.
- Saved conversations, streamed replies, tool activity, stop, reconnect, and approval/clarification cards.
- Connection and profile selection, with independent drafts and explicit conversation ownership.
- Read-only cron jobs across one or all profiles, plus run history, timezone and delivery status.
- An installed MCP UI resource, global/thread entrypoints, and a standalone loopback browser interface.

Hermes owns the agent loop, tools, memory and scheduler. The bridge keeps upstream credentials server-side. Transcript data is returned in UI-only MCP metadata; model-facing tool results contain brief summaries.

The native Codex backend has loaded the plugin, discovered its tools and read the exact built UI. Native visual rendering still needs a manual check because computer-use access to Codex is denied in this environment. See [verification evidence and limitations](docs/verification.md).

## Requirements

- Node.js 22 or later and npm.
- A Hermes installation with its desktop JSON-RPC/WebSocket and cron REST APIs. The validated checkout and protocol assumptions are recorded in [Hermes verification](docs/verification-hermes.md).
- For SSH: an existing SSH configuration, trusted host key and working SSH agent. The connector uses batch mode; test `ssh my-hermes-host true` beforehand.

The first version runs as a local Codex plugin or a standalone browser app. Hosted ChatGPT distribution requires an authenticated remote MCP deployment, which is future work. Nothing here publishes your Hermes server publicly.

## Build and configure

```sh
npm ci
npm run build
cp examples/config.ssh.json hermes.config.json
```

Edit `hermes.config.json` with your host, Hermes repository, Python interpreter and Hermes home. This file is ignored by Git. [SSH](examples/config.ssh.json) and [local HTTP](examples/config.local.json) examples show the available fields. Multiple connections can share one configuration file.

Managed SSH starts a temporary, token-gated Hermes backend on remote loopback and forwards it through SSH. It uses supported process-only settings, disables the desktop scheduler, and cleans up its own process when the bridge closes. It does not install Hermes, edit remote configuration, or restart an existing service. Each bridge process owns its own temporary backend.

For an already running backend, use `kind: "http"`, or `ssh.mode: "attach"` with `remotePort`. Supply authentication using `tokenEnv` or a private `tokenFile`; token files must have private permissions. A dashboard with public authentication needs a valid token from its configured authentication provider. Remote HTTP connections require HTTPS.

## Open in a browser

```sh
npm start -- --config /absolute/path/to/hermes.config.json
```

Open the loopback URL printed by the bridge, normally `http://127.0.0.1:4318`. Use `--port` to choose another port. The bridge validates Host/Origin and sets an HttpOnly, SameSite cookie; upstream credentials never enter the page.

Choose a connection and profile, then open a conversation or write your first message. Enter sends; Shift+Enter adds a line. Stop interrupts the selected conversation. After an uncertain send, check its status before sending again; the extension never repeats a prompt automatically.

Use **Cron jobs** to inspect jobs and recorded runs. Missing delivery or scheduler evidence remains unknown. The first version has no job editing or run-now action.

## Install the private Codex plugin

Preview installation first:

```sh
npm run plugin:install -- --config /absolute/path/to/hermes.config.json
```

Apply the printed plan:

```sh
npm run plugin:install -- --apply --config /absolute/path/to/hermes.config.json
```

The installer stages compiled assets under `~/.codex/plugins/hermes-chatgpt-extension`, preserves the personal marketplace and references the configuration file without copying it. It refuses conflicting or unmanaged installations. `--replace` updates a managed copy and retains a recoverable backup.

Install/enable **Hermes** through Codex's plugin UI, or use the supported Codex CLI for the marketplace named by the installer:

```sh
codex plugin add hermes-chatgpt-extension@personal
```

Open Hermes through the global plugin entrypoint or ask Codex to open Hermes in the current chat. If the desktop app has not discovered the local marketplace, restart it once; CLI/backend installation alone does not prove that its current window refreshed.

For a different MCP Apps host, use `mcp.json` as the stdio configuration. The built server is self-contained and the UI is a single HTML resource. Use a trusted local host: app-only tool visibility is a host-enforced contract, rather than a separate authentication boundary.

## Project structure

- `src/shared/`: frontend/bridge interface contracts.
- `src/hermes/`: Hermes connection and protocol adapter.
- `src/bridge/`: MCP and local HTTP application service.
- `src/web/`: React chat, profile and cron UI.
- `scripts/`: build, plugin packaging and verification helpers.
- `tests/`: protocol, isolation, security and interface tests.
- `plugin.json`, `mcp.json`: installable private plugin.

## Development

```sh
npm run check
npm test
npm run build
npm run plugin:verify
```

`npm run dev` starts the TypeScript bridge with the latest built UI; rebuild after frontend edits. Tests cover protocol events and requests, profile isolation, reconnects, ambiguous outcomes, HTTP security, MCP metadata, UI races and guarded installation. The opt-in live SSH test reads metadata and never sends a prompt or runs a job; see its source for required environment variables.

Known limits: no attachments or Desktop-specific vault/sudo/secret tool peers, no cron mutations, and bounded history/output. Unsupported Hermes peer requests fail explicitly. A backend restart cannot restore an in-flight turn; stored history can still be reopened. Resumes use Hermes's watch-only lazy mode to avoid automatically continuing interrupted work.

The Apps SDK UI dependency pins an older Lodash; this project overrides it with a patched compatible release. CI checks type safety, tests, the final inline bundle, plugin metadata and production dependency audit, and publishes a build artifact.

This repository and its remote are private. Provider keys, SSH keys and Hermes data must remain outside Git.

See [the implementation checklist](TODO.md) and [the researched proposal](docs/proposal.md) for the original scope and follow-up work.
