# Hermes ChatGPT Extension

A private MCP app and Codex plugin for working with local or remote [Hermes](https://github.com/NousResearch/hermes-agent).

The extension provides a Codex-styled chat interface, profile sections and cron inspection. Hermes remains the agent runtime; the extension supplies the interface and connection bridge.

## Version 0.2.3

- Codex sidebar, composer and menu styling, with host theme tokens, Markdown and a mobile drawer.
- Saved conversations, streamed replies, tool activity, stop, reconnect, and approval/clarification cards.
- Expandable sidebar sections for each profile, with its Hermes avatar and owned conversations, independent drafts and explicit conversation ownership.
- A Codex-style Power picker and model list using each profile's configured defaults and available provider/model catalogue. Changes affect the selected conversation only.
- Read-only cron jobs across one or all profiles, plus run history, timezone and delivery status.
- An installed MCP UI resource, global/thread entrypoints, and a standalone loopback browser interface.
- Hermes app title and Nous girl icon, concise welcome text, and connection status beneath the instance name in the sidebar footer.
- **Scheduled** navigation, automated chats hidden by default, and Codex-style chat archiving with Undo.
- Composer refinements measured against the supplied Codex comparison: model/effort beside Send on the right, the native placeholder treatment and disabled-send brightness, and a 20px arrow.

Hermes owns the agent loop, tools, memory and scheduler. The bridge keeps upstream credentials server-side. Transcript data is returned in UI-only MCP metadata; model-facing tool results contain brief summaries.

The native Codex backend has loaded version 0.2.3, discovered its tools and read the exact built UI. The supplied native screenshot establishes the composer differences corrected in this release. Standalone rendering and the current desktop window are checked separately; see [composer verification](docs/verification-composer.md) and [verification evidence and limitations](docs/verification.md).

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

Choose a connection, then expand a profile in the sidebar to see its conversations. Select a saved conversation or start a new chat in that profile. Enter sends; Shift+Enter adds a line. Stop interrupts the selected conversation. After an uncertain send, check its status before sending again; the extension never repeats a prompt automatically.

Hover or focus a conversation to reveal **Archive chat**, using Codex's direct sidebar control. Archiving preserves Hermes's history; **Undo** restores that same conversation. The list changes after Hermes confirms the action. Active or uncertain turns must finish or have their status checked before archiving.

Cron runs and chats tagged by Hermes as `kanban`, `tool` or `oneshot` are hidden from the sidebar by default. The filter runs before the list limit, with an additional check for creation provenance and archived pinned rows. To show tagged automated chats, add `"sidebar": { "showAutomatedChats": true }` alongside `connections` in the bridge configuration. Hermes's own `sessions.show_subagents` setting still governs delegated children. Channel sessions with internal wakes retain their channel origin, so they remain visible when Hermes provides no reliable automation tag. The list shows up to 100 eligible conversations within a bounded 500-row candidate window.

Use the model control beneath the message input to select an available model and reasoning effort. A new chat inherits its profile's defaults. The **Reset to default** icon applies the current profile defaults to the selected conversation. Model changes do not edit the profile's saved configuration. When Hermes asks for confirmation, review its message and explicitly accept the choice before continuing.

Open the picker to adjust Power; click the selected model row to open the available model list. Left/Right adjusts effort and Enter closes the picker. Hermes exposes its reasoning dial and model capabilities, rather than a complete per-model effort matrix. The selector hides unsupported reasoning and excludes disabling it when the model requires it. Hermes maps the selected effort to the provider's supported settings.

Selections survive a client reconnect to the same backend. After the private backend restarts, Hermes's watch-only resume can fall back to the profile defaults. The UI displays the selection returned by Hermes; it does not automatically reapply an earlier override.

Use **Scheduled** to inspect jobs and recorded runs. Missing delivery or scheduler evidence remains unknown. The first version has no job editing or run-now action.

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

Open **Explore → Hermes**, or use [Hermes](codex://plugins/hermes-chatgpt-extension%40personal/app/open_hermes) after installation in the default `personal` marketplace. Hover its Explore entry and choose **Pin to sidebar** to keep it there. In the older text sidebar, use **Explore → Customize** to pin it.

To open it as a tab in the current chat, choose **New tab (+) → More tools… → Plugins and MCPs → Hermes**. Asking Codex to open Hermes can produce an inline app; expand that app to use the full interface. [Entrypoints and deep links](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#deep-links) are provided by the host.

Each UI build uses a resource URI containing its version and HTML hash, so a refreshed connection requests the correct template. If the desktop window still holds an older plugin connection, follow its local plugin refresh/restart flow. CLI/backend installation alone does not prove that its current window refreshed.

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

`npm run dev` starts the TypeScript bridge with the latest built UI; rebuild after frontend edits. Tests cover protocol events and requests, profile isolation, reconnects, ambiguous outcomes, HTTP security, MCP metadata, UI races and guarded installation. Opt-in live SSH tests read metadata or change only an empty test conversation's settings; they never send a prompt or run a job. See their source for required environment variables.

Known limits: no attachments or Desktop-specific vault/sudo/secret tool peers, no cron mutations, and bounded history/output. Unsupported Hermes peer requests fail explicitly. A backend restart cannot restore an in-flight turn; stored history can still be reopened. Resumes use Hermes's watch-only lazy mode to avoid automatically continuing interrupted work.

The Apps SDK UI dependency pins an older Lodash; this project overrides it with a patched compatible release. CI checks type safety, tests, the final inline bundle, plugin metadata and production dependency audit, and publishes a build artifact.

This repository and its remote are private. Provider keys, SSH keys and Hermes data must remain outside Git.

Authentic Hermes fallback brand images retain their MIT attribution in [third-party notices](THIRD_PARTY_NOTICES.md), the installed package and the single-file UI.

See [the implementation checklist](TODO.md) and [the researched proposal](docs/proposal.md) for the original scope and follow-up work.
