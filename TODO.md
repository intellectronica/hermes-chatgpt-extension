# Native interface and model controls

- [x] Verify current Codex sidebar, composer and model/effort selector styling and behaviour.
- [x] Verify Hermes profile avatars, configured defaults, available models and per-session reasoning controls.
- [x] Replace the profile dropdown with expandable sidebar sections containing each profile's chats and avatar.
- [x] Match the Codex chat layout, typography, controls and light/dark appearance.
- [x] Add a Codex-style model/effort selector using real profile defaults and available models.
- [x] Verify session ownership, profile isolation, defaults and model/effort selection against Hermes.
- [x] Verify every requested interface behaviour in narrow/wide, light/dark browser renders.
- [x] Update documentation, build/install v0.2.1 and verify the exact native resource and installed assets.
- [x] Commit/push the native-interface change and pass GitHub CI (implementation a91b82d, run 36854804124).
- [ ] Verify the refreshed v0.2.1 panel in the actual Codex window (the last inspected widget used an older v0.1 connection; the new app link has been provided).

# First-version checklist

- [x] Initialise local repository and private HTTPS GitHub remote.
- [x] Scaffold TypeScript/React project, dependencies and CI.
- [x] Define shared UI/bridge contracts and supported Hermes protocol.
- [x] Build installable MCP plugin with UI resource and global/thread entrypoints.
- [x] Connect to local and remote Hermes with correct authentication.
- [x] Implement chat history, streaming, tool activity, questions and interruption.
- [x] Implement profile selection with explicit ownership and independent drafts.
- [x] Implement read-only cron and run-history views.
- [x] Verify protocol, security, failure/reconnect and profile-isolation behaviour.
- [x] Visually verify light/dark and narrow/wide layouts.
- [x] Verify a real Hermes conversation and profile/cron reads.
- [x] Verify native backend loading and document the exact GUI acceptance blocker; embedded rendering remains unverified.
- [x] Finish setup/usage documentation, push and pass GitHub CI.
