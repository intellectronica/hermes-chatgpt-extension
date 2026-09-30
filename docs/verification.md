# First-version verification

This records observed results, with native rendering separated from backend loading. Detailed evidence is in [Hermes verification](verification-hermes.md) and [plugin verification](verification-plugin.md).

## Repository and package

- GitHub repository: `intellectronica/hermes-chatgpt-extension`, private, HTTPS remote.
- Portable `plugin.json`, typed stdio `mcp.json`, local marketplace and bundled Hermes skill.
- A self-contained Node bridge and single-file React HTML resource. Build parses the final HTML and checks the actual inline script's syntax.
- Guarded installer preserves the personal marketplace and previous managed packages, and references an ignored configuration file without copying it.

## Observed checks

- TypeScript, bridge/config/HTTP/MCP, adapter protocol, frontend ownership/race/controls and installer checks pass locally. Final test totals and CI revision will be added at release close-out.
- Production dependency audit: no reported vulnerabilities after the patched Lodash override.
- Live managed SSH: authenticated REST/WebSocket, profiles, saved-conversation metadata, profile/all-profile cron and run metadata succeeded against Fnordistan. Teardown removed the temporary backend; existing services remained active.
- Native desktop-bundled Codex backend: plugin installed/enabled, 11 tools discovered, global/thread UI entrypoints and the exact built HTML resource loaded.
- Browser UI starts and displays the real connection, profiles and cron inventory. Final layout and controlled conversation checks are being completed.

## Native GUI acceptance limitation

Computer-use access to `com.openai.codex` was denied by the tool, and no MCP Apps browser surface was available. No bypass, app restart or new chat was used. Native backend/resource tests prove loading; they do not prove the current desktop window rendered the panel.

Open **Hermes** from Codex's plugin entrypoint or ask Codex to open it in the current chat. The installed plugin is enabled. If the local marketplace has not refreshed in that window, restart Codex once and open it again. The concrete plugin detail link and install evidence are recorded in [plugin verification](verification-plugin.md).

## Practical limits

- Cron controls are read-only. Delivery and scheduler health remain unknown when the backend provides no evidence.
- Streaming is an event-driven Hermes transcript exposed through bounded MCP/HTTP snapshot polling.
- A client reconnect can recover a live turn and questions. A backend restart preserves saved history, with no guarantee for in-flight work. Prompts are never automatically resent.
- Resumes use watch-only lazy mode, preventing automatic continuation of interrupted sessions.
- History and tool outputs are bounded. Attachments and Desktop-specific vault/sudo/secret peers are unsupported and fail explicitly.
- Hosted ChatGPT distribution and remote HTTPS MCP deployment are future work; this release uses local Codex stdio and a private SSH/HTTP connector.
