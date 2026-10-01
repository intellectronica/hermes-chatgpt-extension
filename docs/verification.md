# Native interface verification

Version **0.2.2** refines the native-style interface and conversation model controls introduced in 0.2.1. It uses the Hermes app title, Nous girl app icon, shorter welcome copy, connection status beneath the instance name and Scheduled navigation. Tagged automated chats are hidden by default, and conversations can be archived with Codex's sidebar control and Undo. The native styling source is recorded in [the Codex reference](native-ui-reference.md); Hermes API and actual UI settings evidence is recorded in [model/avatar verification](verification-hermes-native.md) and [sidebar/archive verification](verification-sidebar-archive.md).

| Requirement | Evidence | Status |
| --- | --- | --- |
| Native Codex appearance | Installed desktop source and browser render: 275px rail, 768px column, 736px composer, 22px composer corners, system typography and host-token mapping; a fresh native snapshot shows the new profile rail and default model control | Source/browser verified; native visual and interaction acceptance incomplete |
| Expandable profile sections and owned chats | Real profile sections; independently cached children; selected older chat stays visible with compact recent list; profile/draft/race checks | Implemented and browser/test verified |
| Hermes profile avatars | Six real avatars from `profiles.get_asset`, bounded raster validation and server-side fetching; all six render at 16px | Live API/browser verified |
| Profile default and available models | Six configured catalogues with 149–151 choices each; every profile default present | Live API verified |
| Model and reasoning selection | Conversation-scoped `config.set`; native-style Power/menu; actual UI radio/keyboard changes and cancel/confirm/reset with backend read-back, no inference | Adapter, live and browser checks pass |
| Profile/default isolation | Complete owner routing; all saved profile config/environment/active-profile hashes unchanged after live settings test | Bridge, adapter and live checks pass |
| Native host package | v0.2.2 installed/enabled; 14 tools, Hermes title and two theme icons, global/thread entrypoints, app-only model and archive controls, exact version-and-hash UI resource read through bundled Codex app-server | Verified; current window refresh remains separate |
| Sidebar filtering and archive | Source exclusions before the list limit, creation-provenance and archived-row checks, configuration toggle, owner-scoped archive acknowledgements and Undo | Adapter/store/component tests and live Hermes archive/restore pass |

Current 0.2.2 checks pass: TypeScript, **81 Vitest checks**, **nine installer checks**, the self-contained build and the 14-tool MCP package/native resource probes. Two opt-in live tests are skipped in the ordinary suite. The separate sidebar/archive run verified six real profiles and reversible archive/restore of the extension-owned echo chat, preserving its transcript and all saved configuration. The native package's exact assets and resource URI are recorded in [plugin verification](verification-plugin.md).

Current standalone browser acceptance covers 1440×900 and 390×844 in light/dark themes. It verifies the shorter welcome text, Scheduled navigation/heading/filter, and Connected under Fnordistan at 12px with a 6px dot. The real Scheduled view returned 11 jobs for the selected profile. No horizontal overflow or page errors occurred. The narrow navigation drawer's axe scan reported zero violations and zero incomplete checks.

A separate static fixture with no Hermes connection verifies the archive control on hover and keyboard focus, acknowledgement-before-removal, same-owner keyboard Undo, narrow success/error behaviour and the source-derived row/control/notification geometry. Its notification axe scan reported zero violations and one incomplete contrast check involving a transient breadcrumb overlap and the SDK Undo button's pseudo-element; that contrast result remains unverified. Screenshots are retained as `hermes-0.2.2-refinements-*` in the task's `outputs` directory. Both owned browser sessions, the static fixture and the owned live HTTP server were closed. These checks made no personal-chat, model-setting or scheduled-job mutations.

## Native-interface baseline (0.2.1)

TypeScript, **66 Vitest checks**, nine guarded installer checks, the self-contained build, the MCP package probe and production dependency audit pass. The two opt-in live checks are skipped in the ordinary suite; the new settings/avatar check passed separately against Fnordistan. Model controls, defaults, profile ownership, race rejection, ambiguity, missing read-back, confirmation and reconnect/restart distinctions are covered. GitHub CI passed for implementation commit `a91b82d903155d15ff37307e8aab71050b17fc10`: [run 36854804124](https://github.com/intellectronica/hermes-chatgpt-extension/actions/runs/36854804124), including the uploaded build artefact.

Final standalone browser acceptance covered light/dark chat, Power/model menus, expanded/compact sections, selected older chats, per-profile A→B→A drafts and local model/effort choices, the mobile focus trap/Escape and read-only Cron. At 1440×900 the rail is 275px, transcript column 768px and visible composer 736×98px with 22px corners; at 390×844 the composer is 358px, navigation is a drawer and the 254px model popup stays in bounds. Navigation rows are 30px, the rail header is 32px, toolbar padding is 16px and the composer footer gap is 4px. All six real profile images loaded at 16px. The composer and page fit both viewports; page errors and final drafts were empty.

The shipped 0.2.1 picker was reloaded after its last CSS correction and inspected without injected styles: its border is zero and its shadow ring is 0.5px. Opening the menu preserves the trigger's exact bounds and keeps the popup centred. ArrowUp moves focus from Power to Select model without changing effort; Enter dismisses the picker and restores the trigger's focus. No message or settings change was submitted in this final rendering check.

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

Computer-use access to `com.openai.codex` was denied by the tool. The permitted MCP Apps surface initially showed v0.1's profile dropdown and Chats navigation from an older running connection. A later fresh native DOM snapshot showed the new profile navigation, six profile sections, New chat and Cron jobs, a connected Fnordistan instance, and the composer control “Model and reasoning: muse-spark-1.3-contributor, Max”. This establishes that the new interface rendered inside Codex.

Further permitted screenshot, DOM and style inspection calls timed out, including a command-dispatch deadline error. The panel continued to appear in the MCP Apps registry. Its loaded avatars, expanded conversation lists, model-menu interaction and final visual match remain unverified inside the host. Standalone browser evidence remains separate. No alternative native-window automation, app restart or new chat was used.

After installing 0.2.2, the actual `open_hermes` call succeeded again, but the permitted MCP Apps registry returned no expanded app tabs before or after that call. This does not establish that the newly installed interface rendered in the existing window. The final native appearance and interaction check remains open.

Use [Hermes](codex://plugins/hermes-chatgpt-extension%40personal/app/open_hermes), or **Explore → Hermes**. Hover the Explore entry and choose **Pin to sidebar** to keep it there; the older text sidebar uses **Explore → Customize**. The installed plugin is enabled. If the host still holds an older connection, follow its local plugin refresh/restart flow. The install and exact resource evidence are recorded in [plugin verification](verification-plugin.md).

## Practical limits

- Cron controls are read-only. Delivery and scheduler health remain unknown when the backend provides no evidence.
- Streaming is an event-driven Hermes transcript exposed through bounded MCP/HTTP snapshot polling.
- A client reconnect can recover a live turn, questions and runtime model selection. A backend restart preserves saved history, with no guarantee for in-flight work. Its lazy resume can fall back to profile model defaults; the UI shows the returned selection and does not automatically reapply an earlier override. Prompts are never automatically resent.
- Resumes use watch-only lazy mode, preventing automatic continuation of interrupted sessions.
- History and tool outputs are bounded. Attachments and Desktop-specific vault/sudo/secret peers are unsupported and fail explicitly.
- Hosted ChatGPT distribution and remote HTTPS MCP deployment are future work; this release uses local Codex stdio and a private SSH/HTTP connector.
