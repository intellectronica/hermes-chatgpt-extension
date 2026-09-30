# Private Codex plugin verification

Verified on 30 September 2026 using ChatGPT desktop's bundled `codex-cli 0.159.2` and the installed Homebrew CLI of the same version. The final source/cache refresh and native resource check completed at 18:06 UTC.

## Packaging and installation

The current native backend accepts the portable root `plugin.json` and typed `mcp.json`. No `.codex-plugin` or legacy `.mcp.json` wrapper is required. The repository marketplace resolves its `./` source against the repository root.

The repository manifest launches `node` with `['${PLUGIN_ROOT}/dist/server.cjs', '--stdio']` and uses `${PLUGIN_ROOT}` as its working directory. The private install adds an absolute `--config` argument in the copied manifest. The configuration contents are not copied, committed or supplied to the UI.

These authorised commands installed the personal source and enabled its native cached plugin:

```sh
node scripts/install-plugin.mjs --config /Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json --dry-run
node scripts/install-plugin.mjs --config /Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json --apply
codex plugin add hermes-chatgpt-extension@personal --json
```

After rebuilding the UI, these commands refreshed the managed source and native cache:

```sh
node scripts/install-plugin.mjs --config /Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json --replace --dry-run
node scripts/install-plugin.mjs --config /Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json --replace --apply
codex plugin add hermes-chatgpt-extension@personal --json
```

The installer retained the previous source directory and marketplace file in timestamped backups. It defaults to dry-run, rejects unmanaged destinations and conflicting Hermes marketplace entries, preserves unrelated marketplace fields and entries, and refuses to overwrite a marketplace edited after planning. It does not enable plugins, edit Codex configuration, restart the app or create chats; the explicit `codex plugin add` command performs native installation and enablement.

| Item | Verified value |
| --- | --- |
| Native plugin ID | `hermes-chatgpt-extension@personal` |
| Personal source | `/Users/eleanor/.codex/plugins/hermes-chatgpt-extension` |
| Native cache | `/Users/eleanor/.codex/plugins/cache/personal/hermes-chatgpt-extension/0.1.0` |
| Personal marketplace | `/Users/eleanor/.agents/plugins/marketplace.json` |
| Private configuration reference | `/Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json` |
| Native installed/enabled state | `true` / `true`, read back with `codex plugin list --marketplace personal --available --json` |

## Checks completed

- `node --test scripts/install-plugin.test.mjs`: nine tests passed, using isolated temporary homes. They cover dry-run, preservation of other marketplace entries, private config references, concurrent edits, conflicting sources, unmanaged destinations, replacement backups, symlink refusal and read-only MCP probing.
- `node scripts/verify-plugin.mjs --probe`: the compiled stdio server initialises, advertises 11 tools, declares both global and thread UI entrypoints, and serves its single-file HTML resource. The verifier does not call any Hermes tools or submit prompts.
- The skill-creator validator accepts `skills/hermes/SKILL.md`.
- Native `plugin/read` recognises MCP server `hermes`, bundled skill `hermes-chatgpt-extension:hermes` and display name `Hermes`.
- A separate app-server process started with `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex app-server --listen stdio://`. After protocol initialisation, `mcpServerStatus/list` with `serverName: "hermes"` and `detail: "full"` discovers the installed plugin's 11 tools with `toolsError: null`. This checks the native backend's command and `${PLUGIN_ROOT}` expansion.
- Native `mcpServer/resource/read` with `server: "hermes"` and `uri: "ui://hermes/app.html"` returns `text/html;profile=mcp-app`. The returned HTML matches the rebuilt file's SHA-256. This check reads the resource without calling Hermes tools or creating a chat.

The rebuilt artefacts have these hashes in the working tree, installed source and native cache:

| File | SHA-256 |
| --- | --- |
| `dist/server.cjs` | `147bfd1c27929814b071ffe14105b1544bf7e198f27089bc230cb6324b356877` |
| `dist/ui.html` | `b5eeb28ac2e2c7440a1c04afc62f12e052544504911381a9422a7fec7f59be49` |

These checks establish native backend loading and resource transport. They do not establish that the current desktop window has refreshed its catalogue or rendered the embedded panel.

Native tool-result `_meta.data` preservation remains unverified. A read-only `mcpServer/tool/call` attempt for `list_profiles` supplied the existing desktop chat ID, without creating or resuming a chat or running a model turn. The separate app-server process returned `thread not found` before executing the tool. The chat was not loaded to work around this boundary.

## Remaining desktop acceptance check

The Computer Use tool refused access to `com.openai.codex` with “Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.” The permitted MCP Apps browser surface was unavailable. No app restart or new chat was performed.

Open the [documented local plugin detail link](codex://plugins/hermes-chatgpt-extension?marketplacePath=%2FUsers%2Feleanor%2F.agents%2Fplugins%2Fmarketplace.json) in the current desktop app, then open Hermes from its global sidebar entry or the panel menu of an existing chat. Verify the native panel loads the real Fnordistan connection, offers profile selection, displays cron jobs, and uses the host theme. Confirm chat submission and any approvals only through the intended UI flow.

If the current window does not discover the plugin, the [official local installation instructions](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) specify restarting the desktop app after local installation or updates. A restart remains a manual acceptance step; successful CLI enablement does not prove live refresh of the existing GUI.

The [local deep-link reference](https://learn.chatgpt.com/docs/reference/commands#local-plugin) documents opening this detail page without creating a chat.
