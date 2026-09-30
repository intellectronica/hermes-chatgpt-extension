# Hermes adapter verification

Verified on 30 September 2026. This records the adapter separately from MCP host embedding and UI checks.

## Source and supported contracts

The implementation follows the current Hermes Desktop JSON-RPC/WebSocket and REST subset, researched at public upstream commit [`653bc4f288fc00db362c1082a3b652542314fbef`](https://github.com/NousResearch/hermes-agent/tree/653bc4f288fc00db362c1082a3b652542314fbef). The installed remote checkout inspected and used for the metadata smoke test was `e5efafb475ed3dabe769ecfff335d2f974a1e8b9`, with a clean working tree. These are evidence points, rather than a promise of compatibility with every Hermes release.

- WebSocket `/api/ws`: `client.capabilities`, `profiles.list`, `session.list`, `session.create`, `session.resume`, `prompt.submit`, `session.interrupt`, `session.events.since`, `ping`; `message.*`, `tool.*`, session/error/control events; peer `approval` and `clarify` requests. See [programmatic integration](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/website/docs/developer-guide/programmatic-integration.md), [session contracts](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/tui_gateway/contracts/sessions.py) and [profile methods](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/tui_gateway/methods_profiles.py).
- Read-only management: `GET /api/cron/jobs?profile=...` and `GET /api/cron/jobs/{jobId}/runs?profile=...&limit=...`. Job owners are retained when viewing all profiles. Execution and delivery outcomes remain unknown when the response does not provide evidence. No scheduler-health claim is inferred from saved run output. See [desktop cron client](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/apps/desktop/src/api/cron.ts).
- Identifiers: every public operation carries a configured connection, concrete profile and stored session/job ID. Runtime session IDs are used only for upstream calls within that owner's record. No profile switch changes the host's default profile; no model/provider override is sent.

## Managed SSH lifecycle

Managed mode uses the existing SSH agent and strict normal SSH host-key verification. A remote Python supervisor receives its per-process random token and optional paths over stdin. The token is not an argument, a file or a public result. The supervisor starts the already-installed Hermes interpreter and repository:

```text
python -m hermes_cli.main -p default serve --isolated --host 127.0.0.1 --port 0
```

Only this child process receives `HERMES_DASHBOARD_SESSION_TOKEN`, `HERMES_HOME`, `HERMES_PARENT_PID` and the documented `HERMES_DASHBOARD_PUBLIC_URL=http://127.0.0.1` runtime override. The latter makes the private listener use loopback token authentication even when the user's separate dashboard has a public URL. `HERMES_DESKTOP` is removed from the child's inherited environment: the ordinary serve path does not start the Desktop-owned cron ticker. The supervisor parses `HERMES_BACKEND_READY`, then the bridge opens an SSH forward from an ephemeral local loopback port to the child's remote loopback port.

On bridge disposal or SSH stdin EOF, the supervisor terminates only its own child's new process group, waits for graceful exit and bounds its fallback kill. It does not install Hermes, change persisted configuration, restart existing services, replace the user's dashboard or start a cron job. Hermes itself can maintain normal runtime locks and state as part of starting its backend; the metadata checks do not call mutating management routes. Explicit-token HTTP/HTTPS and SSH attach modes remain available for an existing compatible listener.

The safety checks come from [dashboard URL override precedence](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/hermes_cli/dashboard_auth/prefix.py) and [serve lifespan/ticker ownership](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/hermes_cli/web_server.py). Plain HTTP is accepted only on loopback; remote direct HTTP requires HTTPS. Credentials stay in the bridge. HTTP redirects are refused, upstream error bodies are omitted, tokens are redacted, and response/history/tool sizes are bounded.

## Reconnect and questions

Every resume sends `lazy: true` and `inline_images: false`. Hermes's ordinary cold resume can automatically continue a crash marker when `desktop.auto_continue` is enabled, including by default. The supported lazy/watch path does not schedule that continuation or build an agent; an explicit user `prompt.submit` upgrades the session. Reattaching a session already live in this backend returns its authoritative running/inflight snapshot. See [`_resume_lazy` and cold resume](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/tui_gateway/methods_session.py) and [auto-continue behaviour](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/tui_gateway/session_auto_continue.py).

An ambiguous acknowledgement becomes unknown. The adapter never automatically sends that prompt again. It re-reads the same stored session, reconstructs live partial text/retained errors, and replays work/control events where the runtime ID and replay epoch still match. Advertised `ping` heartbeats detect stalled transports. During a long turn, periodic lazy snapshots reconcile the streamed view. The event ring is bounded and in memory; a backend or bridge restart can lose in-flight execution, pending questions and unsaved output. Saved history alone does not demonstrate that an ambiguous operation never executed. See [event replay bounds and epochs](https://github.com/NousResearch/hermes-agent/blob/653bc4f288fc00db362c1082a3b652542314fbef/tui_gateway/event_replay.py).

Approval answers map offered choices to Hermes's `once`, `session` and `deny`; boolean UI fallback maps to `once`/`deny`. Permanent `always` approval is excluded. Clarifications preserve upstream question IDs and send one `{answers}` response after all questions are answered. Withdrawn questions disappear. Unsupported peer methods, including credential/sudo/connector and other Desktop-only requests, receive an explicit JSON-RPC error. The extension does not advertise the full Hermes Desktop feature set.

## Completed checks

- `npx vitest run tests/hermes-service.test.ts`: 11 passing adapter tests using an actual local HTTP/WebSocket peer and the pinned contract subset, with no model calls. They cover profile ownership with colliding stored IDs, late events, lost acknowledgements without resend, lazy/inflight restore, retained failure, stop versus completion, approval/clarification ownership and cancellation, unsupported requests, bounded/redacted output, read-only cron routes, authentication errors and malformed RPC frames.
- `npm run check`: TypeScript passed after adapter and bridge integration.
- `HERMES_LIVE_SSH_TEST=1 npx vitest run tests/hermes-live.test.ts`: one opt-in test passed against the installed remote checkout. It launched the private managed backend, read the real profile roster, recent session metadata, per-profile/all-profile cron lists and existing run metadata, then disposed the connection. It created no conversation, sent no model prompt and triggered no job.
- Remote read-back after disposal found no connector supervisor/private serve process; the existing personal gateway and dashboard services remained active.
- The parent integration check sent a deliberately authorised echo prompt in a new default-profile session and observed streaming, final idle state and the exact expected `HERMES_EXTENSION_OK` response. That turn used no tools or peer questions. It ran before the final lazy-resume and cron-status corrections; those corrections have the contract regressions above.

The metadata smoke test proves the managed transport, authentication, management contracts and normal cleanup on that installation; the controlled echo additionally demonstrates a simple live send/stream/complete path. Live stop/tool/question behaviour, bridge recovery after abrupt termination, other Hermes releases and actual Codex embedding need their own evidence; the unit peer is not a substitute for those checks.
