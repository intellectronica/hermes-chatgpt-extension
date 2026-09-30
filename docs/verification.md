# First-version verification

This records observed results, with native rendering separated from backend loading. Detailed evidence is in [Hermes verification](verification-hermes.md) and [plugin verification](verification-plugin.md).

## Repository and package

- GitHub repository: `intellectronica/hermes-chatgpt-extension`, private, HTTPS remote.
- Portable `plugin.json`, typed stdio `mcp.json`, local marketplace and bundled Hermes skill.
- A self-contained Node bridge and single-file React HTML resource. Build parses the final HTML and checks the actual inline script's syntax.
- Guarded installer preserves the personal marketplace and previous managed packages, and references an ignored configuration file without copying it.

## Observed checks

- TypeScript, 40 Vitest checks and 9 installer checks pass locally. They cover bridge/config/HTTP/MCP, adapter protocol and frontend ownership/race/controls. The opt-in live SSH test passed separately on the final adapter (16.59 seconds).
- Production dependency audit: no reported vulnerabilities after the patched Lodash override.
- Live managed SSH: authenticated REST/WebSocket, profiles, saved-conversation metadata, profile/all-profile cron and run metadata succeeded against Fnordistan. Teardown removed the temporary backend; existing services remained active.
- Native desktop-bundled Codex backend: plugin installed/enabled, 11 tools discovered, global/thread UI entrypoints and the exact built HTML resource loaded.
- Browser UI displays the real connection, six profiles, 55 jobs across all profiles, cross-profile run history and the controlled echo conversation. The live echo streamed to an idle completion with the expected reply and no tool calls.
- Browser light/dark layouts at 1440×900 and 390×844 fit their viewports; the composer stays visible. The mobile drawer traps focus, closes with Escape and restores the opener's focus. The final narrow transcript accessibility scan reports zero violations and zero incomplete checks (35 passed). Browser page errors are empty.
- GitHub CI passed for implementation commit `55d7735220ba3a04f34274eaf2d6e1976566dcbd`: [run 36756732851](https://github.com/intellectronica/hermes-chatgpt-extension/actions/runs/36756732851). The workflow runs on every subsequent push and retains the compiled plugin as an artefact.

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
