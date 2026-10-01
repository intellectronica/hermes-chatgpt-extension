# Architecture

Hermes runs its own agent loop, tools, memory and scheduler. This extension provides a separate chat application inside Codex using MCP Apps; the surrounding Codex chat keeps its own runtime.

## Components

- **React UI:** profile sections, saved chats, transcript and composer, conversation model/reasoning controls, chat archive/Undo and the read-only Scheduled view. Host tokens and OpenAI UI components supply familiar typography, surfaces, menus and icons.
- **MCP bridge:** a stdio plugin with global/thread app entrypoints and a self-contained HTML resource. Large transcript data is carried in app metadata rather than model-visible text.
- **Local HTTP preview:** the same application served on loopback for development, with an HttpOnly authentication cookie and Host/Origin validation. This preview is separate from a remote Hermes HTTP connection.
- **Hermes adapter:** authenticated desktop JSON-RPC over WebSocket and structured REST management endpoints. It supports directly configured HTTP/HTTPS instances, SSH tunnels to existing backends, and owned backends started over SSH.
- **Configuration:** an array of independently identified connections; token values remain in server-side environment variables or files. The package contains no default remote connection. See [README](../README.md) for schemas and examples.

## Ownership and failure handling

Every operation belongs to a connection, profile and stored session or job. Changing the selected profile affects future conversations and visible navigation, without changing an existing conversation's owner or the machine's active profile. Model and reasoning changes are conversation-scoped and honour Hermes confirmations.

A client reconnect can reconcile a live turn; a backend restart cannot guarantee its in-flight work survived. Prompts are never automatically resent after an ambiguous acknowledgement. Lazy watch-only resumes read saved history without restarting an interrupted turn.

Archived chats retain their stored history. Scheduled jobs and their run records are read-only; execution, delivery and scheduler health are reported separately. Automated chats are excluded by default using backend provenance, with a configuration option to include them.

## Distribution

The installable package bundles the Node bridge, UI, assets, skills, manifests and licences. A private connection file remains outside that package and is referenced by the installed MCP manifest. The source package excludes Git history and runtime configuration so it can seed a separate clean repository.

This release targets local Codex plugins. A hosted ChatGPT app requires its own HTTPS MCP deployment, authentication and host validation; shipping the local stdio package does not complete that work.
