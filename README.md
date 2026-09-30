# Hermes ChatGPT Extension

A private MCP plugin for working with local or remote [Hermes](https://github.com/NousResearch/hermes-agent) inside Codex and ChatGPT.

The first release provides a familiar chat interface, profile switching and cron inspection. Hermes remains the agent runtime; the extension supplies the interface and connection bridge.

## Status

Repository initialised. The first version is under construction. See [the implementation checklist](TODO.md) and [the researched proposal](docs/proposal.md).

## Planned structure

- `src/shared/`: frontend/bridge interface contracts.
- `src/hermes/`: Hermes connection and protocol adapter.
- `src/bridge/`: MCP and local HTTP application service.
- `src/web/`: React chat, profile and cron UI.
- `scripts/`: build, plugin packaging and verification helpers.
- `tests/`: protocol, isolation, security and interface tests.
- `plugin.json`, `mcp.json`: installable private plugin.

## Development

Node.js 22 or later and npm are required. Build and run instructions will be added with the scaffold.

This repository and its remote are private. Provider keys, SSH keys and Hermes data must remain outside Git.

