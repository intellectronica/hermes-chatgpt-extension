---
name: hermes
description: Open the embedded Hermes application in Codex or inspect configured Hermes connections, profiles and cron status.
---

Use this plugin's `open_hermes` tool when the user wants to work in the Hermes interface. The application owns its Hermes transcript and composer; the surrounding Codex chat keeps its own conversation.

For status requests, use the plugin's structured read tools. Resolve a connection and profile from the request or available connection/profile metadata. If a consequential request still has several plausible owners, ask the user to choose. Identify cron jobs and runs by their connection, owning profile and job ID.

Profile selection changes the visible context and the target for new Hermes conversations. It does not change the machine's default profile or reassign existing sessions. Treat schedule state, execution outcome and delivery outcome separately; missing evidence is unknown.

The first version provides cron inspection only. Opening Hermes or inspecting status does not authorise prompts, job execution, cron edits, service restarts or connection changes. Keep provider credentials and SSH secrets out of responses.

If the application cannot open, report the actual host or backend error. A browser preview or successful MCP resource read does not prove that Codex rendered the embedded UI.
