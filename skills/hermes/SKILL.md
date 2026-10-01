---
name: hermes
description: Open the embedded Hermes application in Codex or inspect configured Hermes connections, profiles and cron status.
---

Use this plugin's `open_hermes` tool when the user wants to work in the Hermes interface. The application owns its Hermes transcript and composer; the surrounding Codex chat keeps its own conversation.

For status requests, use the plugin's structured read tools. Resolve a connection and profile from the request or available connection/profile metadata. If a consequential request still has several plausible owners, ask the user to choose. Identify cron jobs and runs by their connection, owning profile and job ID.

Profiles appear as expandable sidebar sections with their Hermes avatars and conversations. Profile selection changes the visible context and the target for new Hermes conversations. It does not change the machine's default profile or reassign existing sessions. The composer model/effort control uses the selected profile's defaults and available models; explicit changes affect the selected conversation only. Honour Hermes's required model confirmations. Treat schedule state, execution outcome and delivery outcome separately; missing evidence is unknown.

The Scheduled view remains read-only. Chat archive/restore is an explicit, reversible conversation action that preserves history; do not archive a chat without the user's request. Opening Hermes or inspecting status does not authorise prompts, job execution, cron edits, service restarts or connection changes. Keep provider credentials and SSH secrets out of responses.

If the application cannot open, report the actual host or backend error. A browser preview or successful MCP resource read does not prove that Codex rendered the embedded UI.
