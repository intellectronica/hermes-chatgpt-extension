# Private Codex plugin verification

Version **0.2.2** verified on 1 October 2026 using ChatGPT desktop's bundled `codex-cli 0.159.2`. The managed source/cache refresh completed at 12:35 UTC, followed by an exact native resource check in a fresh app-server process. Native loading and the existing desktop panel are checked separately below.

## Packaging and installation

The current native backend accepts the portable root `plugin.json` and typed `mcp.json`. No `.codex-plugin` or legacy `.mcp.json` wrapper is required. The repository marketplace resolves its `./` source against the repository root.

The repository manifest launches `node` with `['${PLUGIN_ROOT}/dist/server.cjs', '--stdio']` and uses `${PLUGIN_ROOT}` as its working directory. The private install adds an absolute `--config` argument in the copied manifest. The configuration contents are not copied, committed or supplied to the UI.

The manifest packages `assets/nous-girl.png` and `assets/nous-girl-dark.png` as listing/composer logos. Both are the original 256×256 Hermes images. The MCP server supplies the same images as light/dark data-URI icons and the title Hermes. The opener's RPC name remains `open_hermes`. The current host masks entrypoint icons to monochrome; final icon appearance in the existing window is unverified.

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
| Native cache | `/Users/eleanor/.codex/plugins/cache/personal/hermes-chatgpt-extension/0.2.2` |
| Personal marketplace | `/Users/eleanor/.agents/plugins/marketplace.json` |
| Private configuration reference | `/Users/eleanor/repos/hermes-chatgpt-extension/hermes.config.json` |
| Native installed/enabled state | `true` / `true`, read back with `codex plugin list --marketplace personal --available --json` |

## Checks completed

- `node --test scripts/install-plugin.test.mjs`: nine tests passed, using isolated temporary homes. They cover dry-run, preservation of other marketplace entries, private config references, concurrent edits, conflicting sources, unmanaged destinations, replacement backups, symlink refusal and read-only MCP probing.
- `node scripts/verify-plugin.mjs --probe`: the compiled stdio server initialises, advertises 14 tools, declares both global and thread UI entrypoints, checks the Hermes title/theme icons, and serves its single-file HTML resource. The verifier does not call any Hermes tools or submit prompts.
- The skill-creator validator accepts `skills/hermes/SKILL.md`.
- Native `plugin/read` recognises MCP server `hermes`, bundled skill `hermes-chatgpt-extension:hermes` and display name `Hermes`.
- A separate app-server process started with `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex app-server --listen stdio://`. After protocol initialisation, `mcpServerStatus/list` with `serverName: "hermes"` and `detail: "full"` discovers the installed plugin's 14 tools with `toolsError: null`, server version `0.2.2`, title Hermes and two 256×256 theme icons. Both model controls and `archive_chat` have app-only visibility. This checks the native backend's command and `${PLUGIN_ROOT}` expansion. Its owned process was closed after verification.
- Native `mcpServer/resource/read` with `server: "hermes"` and `uri: "ui://hermes/v0.2.2/app-a1ba79353f8a032e.html"` returns `text/html;profile=mcp-app`. The returned HTML matches the rebuilt file's SHA-256, including the URI's hash prefix. This check reads the resource without calling Hermes tools or creating a chat.
- Every rendering tool refers to the same resource URI, containing the plugin version and the HTML’s SHA-256 prefix. Identical builds produce the same key; changed HTML produces a different key. The earlier URI was also v0.1's cache key; the structural update now follows the [official resource caching guidance](https://developers.openai.com/plugins/build/chatgpt-ui). The plugin includes the Hermes brand images' MIT notice, also embedded in the self-contained HTML.

The rebuilt artefacts have these hashes in the working tree, installed source and native cache:

| File | SHA-256 |
| --- | --- |
| `dist/server.cjs` | `7a0455f5801b86c36480a2c549cac78fff120f008668070c24fc9a16c23ae33a` |
| `dist/ui.html` | `a1ba79353f8a032e841674130b46df209a8d26473ef1a6c6b9248b48266b6109` |
| `THIRD_PARTY_NOTICES.md` | `476930b1540e59a2c8c3fdff0b9182765ad5efdbe99075ffa04be0a1a173852e` |
| `assets/nous-girl.png` | `8b4a61752b89aade9e176247e262197fa0748603dd7fc03f8b5a3b24a4445184` |
| `assets/nous-girl-dark.png` | `66d0b49e6fad2f1df68c3788dfd60d694c5261fdf1a55891b0cc1b677024141b` |

These checks establish native backend loading and resource transport. They do not establish that the current desktop window has refreshed its catalogue or rendered the embedded panel.

The actual model-visible `open_hermes` call succeeded. The first user-expanded panel showed the older v0.1 dropdown/Chats design. Its host variables resolved to a 14px base, 13px controls, weight 430 and Geist/Inter/system fonts. A later fresh native DOM snapshot showed 0.2.1's profile sections, six profiles, New chat, Cron jobs, a connected Fnordistan instance and the configured model/Max control. This establishes partial native rendering of the new composition. It does not establish loaded avatars, expanded conversation children, model-menu interaction or a final visual match.

## Remaining desktop acceptance check

The Computer Use tool refused access to `com.openai.codex` with “Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.” The user subsequently expanded Hermes, allowing the partial inspection above through the permitted MCP Apps surface. Further screenshot, DOM and style inspections timed out, including a pre-dispatch deadline error. After the 0.2.2 install, the actual opener succeeded again, but the permitted registry returned no expanded app tabs before or after it. Final native appearance and interactions remain a separate check. No alternative native-window automation, app restart or new chat was performed.

After refreshing the host connection, open Hermes from its global sidebar entry or the panel menu of an existing chat. Verify expandable profile sections and avatars, the composer Power/model selector, Hermes title/icon, Scheduled navigation and connection status under the instance name. Verify host theme inheritance and the archive control on an extension-owned test conversation. No prompt is needed to check rendering.

Native sidebar app **Refresh** refetches a registered app-lifetime widget's resource, but does not restart its MCP server; it may not apply to the expanded inline tool widget. The [documented app-server reload API](https://learn.chatgpt.com/docs/app-server) queues a broader MCP configuration refresh for loaded chats and has no Hermes-only targeting parameter in the installed protocol. It was not invoked across other chats. If the current window still holds the earlier plugin, the [official local installation instructions](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) specify restarting the desktop app after local installation or updates. Successful CLI enablement does not prove live refresh of the existing GUI.

The installed global app can be opened directly with [Hermes](codex://plugins/hermes-chatgpt-extension%40personal/app/open_hermes), using the installed `personal` marketplace identity. In desktop 26.928.21956 the source-backed routes are **Explore → Hermes** and **New tab (+) → More tools… → Plugins and MCPs → Hermes**. Explore’s hover action **Pin to sidebar**, or the older **Explore → Customize** screen, controls sidebar pinning. See the [official app-entrypoint and deep-link contract](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#deep-links). The active sidebar variant was not inspected because native-window access is denied.
