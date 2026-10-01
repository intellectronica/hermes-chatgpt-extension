# Private Codex plugin verification

Version **0.2.1** verified on 1 October 2026 using ChatGPT desktop's bundled `codex-cli 0.159.2`. The final source/cache refresh and native resource check completed at 11:16 UTC. Native loading and the expanded panel are checked separately below.

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
| Native cache | `/Users/eleanor/.codex/plugins/cache/personal/hermes-chatgpt-extension/0.2.1` |
| Personal marketplace | `/Users/eleanor/.agents/plugins/marketplace.json` |
| Private configuration reference | `/Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json` |
| Native installed/enabled state | `true` / `true`, read back with `codex plugin list --marketplace personal --available --json` |

## Checks completed

- `node --test scripts/install-plugin.test.mjs`: nine tests passed, using isolated temporary homes. They cover dry-run, preservation of other marketplace entries, private config references, concurrent edits, conflicting sources, unmanaged destinations, replacement backups, symlink refusal and read-only MCP probing.
- `node scripts/verify-plugin.mjs --probe`: the compiled stdio server initialises, advertises 13 tools, declares both global and thread UI entrypoints, and serves its single-file HTML resource. The verifier does not call any Hermes tools or submit prompts.
- The skill-creator validator accepts `skills/hermes/SKILL.md`.
- Native `plugin/read` recognises MCP server `hermes`, bundled skill `hermes-chatgpt-extension:hermes` and display name `Hermes`.
- A separate app-server process started with `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex app-server --listen stdio://`. After protocol initialisation, `mcpServerStatus/list` with `serverName: "hermes"` and `detail: "full"` discovers the installed plugin's 13 tools with `toolsError: null` and server version `0.2.1`. Both new model controls have app-only visibility. This checks the native backend's command and `${PLUGIN_ROOT}` expansion.
- Native `mcpServer/resource/read` with `server: "hermes"` and `uri: "ui://hermes/v0.2.1/app-0068b52cb24cc3a7.html"` returns `text/html;profile=mcp-app`. The returned HTML matches the rebuilt file's SHA-256, including the URI's hash prefix. This check reads the resource without calling Hermes tools or creating a chat.
- Every rendering tool refers to the same resource URI, containing the plugin version and the HTML’s SHA-256 prefix. Identical builds produce the same key; changed HTML produces a different key. The earlier URI was also v0.1's cache key; the structural update now follows the [official resource caching guidance](https://developers.openai.com/plugins/build/chatgpt-ui). The plugin includes the Hermes brand images' MIT notice, also embedded in the self-contained HTML.

The rebuilt artefacts have these hashes in the working tree, installed source and native cache:

| File | SHA-256 |
| --- | --- |
| `dist/server.cjs` | `98dd7a6246d8bb4e6d05094623c3e4139c53ddf8a09f3867e995432ac0eb3f30` |
| `dist/ui.html` | `0068b52cb24cc3a720a480ef0e61875532d6f06193afcec4182afc7ac0218b72` |
| `THIRD_PARTY_NOTICES.md` | `a2eb8ed431477bde60a1981ea500f6f2dfff8b4653f2759447effdbfeb16edfc` |

These checks establish native backend loading and resource transport. They do not establish that the current desktop window has refreshed its catalogue or rendered the embedded panel.

The actual model-visible `open_hermes` call succeeded. After the user expanded its widget, the permitted MCP Apps surface showed a real connected Fnordistan interface and six profiles. That panel still rendered the earlier v0.1 dropdown/Chats design; it is evidence for the older native connection and metadata transport, not the final v0.2 interface. Its actual host variables resolved to a 14px base, 13px controls, weight 430 and Geist/Inter/system fonts. The new UI uses those resolved font-size/weight/family tokens directly.

## Remaining desktop acceptance check

The Computer Use tool refused access to `com.openai.codex` with “Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.” The user subsequently expanded Hermes, allowing inspection through the permitted MCP Apps surface. The last inspected widget came from an older running connection; it was subsequently closed. The refreshed v0.2.1 panel remains a separate visual check. No alternative native-window automation, app restart or new chat was performed.

After refreshing the host connection, open Hermes from its global sidebar entry or the panel menu of an existing chat. Verify that the new panel shows expandable profile sections with avatars and the composer Power/model selector, rather than v0.1's profile dropdown. Verify cron reads and host theme inheritance. Do not submit a prompt to check rendering.

Native sidebar app **Refresh** refetches a registered app-lifetime widget's resource, but does not restart its MCP server; it may not apply to the expanded inline tool widget. The [documented app-server reload API](https://learn.chatgpt.com/docs/app-server) queues a broader MCP configuration refresh for loaded chats and has no Hermes-only targeting parameter in the installed protocol. It was not invoked across other chats. If the current window still holds the earlier plugin, the [official local installation instructions](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) specify restarting the desktop app after local installation or updates. Successful CLI enablement does not prove live refresh of the existing GUI.

The installed global app can be opened directly with [Open Hermes](codex://plugins/hermes-chatgpt-extension%40personal/app/open_hermes), using the installed `personal` marketplace identity. In desktop 26.928.21956 the source-backed routes are **Explore → Open Hermes** and **New tab (+) → More tools… → Plugins and MCPs → Open Hermes**. Explore’s hover action **Pin to sidebar**, or the older **Explore → Customize** screen, controls sidebar pinning. See the [official app-entrypoint and deep-link contract](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#deep-links). The active sidebar variant was not inspected because native-window access is denied.
