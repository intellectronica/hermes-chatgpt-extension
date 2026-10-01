# Native interface verification

Version **0.2.1** implements the native-style interface and conversation model controls. The acceptance checks below follow the requested outcome. The native styling source is recorded in [the Codex reference](native-ui-reference.md); Hermes API and actual UI settings evidence is recorded in [model/avatar verification](verification-hermes-native.md).

| Requirement | Evidence | Status |
| --- | --- | --- |
| Native Codex appearance | Installed desktop source and browser render: 275px rail, 768px column, 736px composer, 22px composer corners, system typography and host-token mapping | Source/browser verified; current native widget still v0.1 |
| Expandable profile sections and owned chats | Real profile sections; independently cached children; selected older chat stays visible with compact recent list; profile/draft/race checks | Implemented and browser/test verified |
| Hermes profile avatars | Six real avatars from `profiles.get_asset`, bounded raster validation and server-side fetching; all six render at 16px | Live API/browser verified |
| Profile default and available models | Six configured catalogues with 149–151 choices each; every profile default present | Live API verified |
| Model and reasoning selection | Conversation-scoped `config.set`; native-style Power/menu; actual UI radio/keyboard changes and cancel/confirm/reset with backend read-back, no inference | Adapter, live and browser checks pass |
| Profile/default isolation | Complete owner routing; all saved profile config/environment/active-profile hashes unchanged after live settings test | Bridge, adapter and live checks pass |
| Native host package | v0.2.1 installed/enabled; 13 tools, global/thread entrypoints, app-only model controls, exact version-and-hash UI resource read through bundled Codex app-server | Verified; current window refresh remains separate |

TypeScript, **66 Vitest checks**, nine guarded installer checks, the self-contained build, the MCP package probe and production dependency audit pass. The two opt-in live checks are skipped in the ordinary suite; the new settings/avatar check passed separately against Fnordistan. Model controls, defaults, profile ownership, race rejection, ambiguity, missing read-back, confirmation and reconnect/restart distinctions are covered. GitHub CI is checked on the pushed commit before completion.

Final standalone browser acceptance covered light/dark chat, Power/model menus, expanded/compact sections, selected older chats, per-profile A→B→A drafts and local model/effort choices, the mobile focus trap/Escape and read-only Cron. At 1440×900 the rail is 275px, transcript column 768px and visible composer 736px with 22px corners; at 390×844 the composer is 358px, navigation is a drawer and the 254px model popup stays in bounds. All six real profile images loaded at 16px. The composer and page fit both viewports; page errors and final drafts were empty.

Axe reported zero violations. Chat, mobile navigation and Cron had zero incomplete checks. Popup checks retained an SDK dynamic `aria-controls` finding whose referenced menu ID was present; the model list also had partly clipped colour-contrast findings. Manual inspection confirmed opaque `#0d0d0d` and `#5d5d5d` model text on white, matching the passing visible rows. The keyboard-focusable model scroll group, actual Left/Right effort adjustment and Enter dismissal were checked. Screenshots of light/dark chat, Power, model list, mobile profiles/chat/model list and Cron/run history are retained in the task's `outputs` directory.

Live Cron reads returned 11 default-profile jobs and 55 jobs across all six profiles. Opening factoryfnord's kanban-label-sync from the default profile returned 20 correctly owned run records. Europe/Zurich display timezone and missing schedule/delivery evidence remain distinct. No mutation or run-now control is exposed.

# First-version verification (historical)

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

Computer-use access to `com.openai.codex` was denied by the tool. After the user expanded Hermes, the permitted MCP Apps surface became available and showed the actual connected interface. It still rendered v0.1's profile dropdown and Chats navigation from an earlier running connection. The new UI now has its own versioned resource URI, following the host's caching contract. Final v0.2 native rendering requires a refreshed host connection; backend/resource and standalone browser checks do not prove that refresh occurred. No bypass, app restart or new chat was used.

Open **Hermes** from Codex's plugin entrypoint or ask Codex to open it in the current chat. The installed plugin is enabled. If the local marketplace has not refreshed in that window, restart Codex once and open it again. The concrete plugin detail link and install evidence are recorded in [plugin verification](verification-plugin.md).

## Practical limits

- Cron controls are read-only. Delivery and scheduler health remain unknown when the backend provides no evidence.
- Streaming is an event-driven Hermes transcript exposed through bounded MCP/HTTP snapshot polling.
- A client reconnect can recover a live turn, questions and runtime model selection. A backend restart preserves saved history, with no guarantee for in-flight work. Its lazy resume can fall back to profile model defaults; the UI shows the returned selection and does not automatically reapply an earlier override. Prompts are never automatically resent.
- Resumes use watch-only lazy mode, preventing automatic continuation of interrupted sessions.
- History and tool outputs are bounded. Attachments and Desktop-specific vault/sudo/secret peers are unsupported and fail explicitly.
- Hosted ChatGPT distribution and remote HTTPS MCP deployment are future work; this release uses local Codex stdio and a private SSH/HTTP connector.
