# Hermes ChatGPT Extension

Build a private MCP plugin that presents Hermes chat, profiles and cron inspection inside Codex/ChatGPT. Read `docs/proposal.md` and `README.md` before substantial changes.

## Scope and architecture

- The frontend owns the Hermes transcript and composer. Hermes owns its agent loop, tools, profiles, memory and scheduler.
- Reuse the Hermes desktop JSON-RPC/WebSocket backend and structured REST management routes. Do not scrape CLI output or duplicate Hermes internals.
- Keep the React UI, MCP/HTTP bridge, configuration and Hermes protocol adapter separate.
- First version: local and SSH connections, chat history/send/stop/tool activity/questions/reconnect, profile selection, read-only cron and run history.
- Per-conversation model and reasoning selection is authorised. Inherit each profile's configured defaults and offer its available models; never change the machine's default profile or saved provider configuration.
- Do not add cron mutation, global model/provider overrides, generic shell execution, remote installs/restarts or public publishing without explicit authorisation.

## Correctness and security

- Every operation is explicitly owned by connection, profile and stored session/job ID. Switching profile never changes an existing session's owner or the machine's default profile.
- Never automatically repeat a prompt after an ambiguous acknowledgement. Reconcile the original session; report unknown/interrupted outcomes where needed.
- Backend restart is different from client reconnect. Durable history is not durable in-flight execution.
- Negotiate only capabilities implemented here. Fail unsupported peer requests clearly; never silently approve them.
- Keep upstream credentials on the server, never in the UI, model-visible results, logs, screenshots or Git. Bound outputs and error messages.
- Local HTTP binds to loopback, validates Host/Origin and requires a per-process token for data/action endpoints. MCP app controls are UI-only where appropriate.
- Render Markdown as text with sanitised links; do not enable raw HTML.
- Report cron execution, delivery and scheduler health separately. Missing evidence is unknown.

## Workflow

- Use British English and plain, concise UI copy.
- Check relevant skills. Use Worktrunk (`wt`) worktrees and topic branches; do not switch branches in a shared checkout.
- This repository belongs to `intellectronica`, not `Jimini-AI`; Jimini-specific engineering workflows do not apply.
- Delegation is encouraged for clearly bounded independent work. Give agents distinct file ownership and a shared interface contract.
- Before finishing code work, run `npm run check`, `npm test`, `npm run build` and relevant browser/integration tests. Wait for GitHub CI on the pushed commit and fix failures.
- Verify the rendered UI in light/dark and narrow/wide layouts. The target is the familiar ChatGPT/Codex appearance using host tokens and OpenAI UI components.
- Commit coherent changes, push them and leave a clean worktree. Never claim host embedding or live Hermes behaviour from unit tests alone.
- Keep `TODO.md` and `docs/verification.md` accurate. Record completed checks, known limitations and exact evidence without secrets.
- Use `trash`, never `rm`, for file deletion. Do not modify personal Hermes services/configuration while testing this extension.
