# Composer comparison and verification

Version **0.2.3**, 1 October 2026. The reference is the user's supplied side-by-side native Codex/Hermes screenshot, compared with the installed Codex **26.928.21956** source. No private native code or supplied image is packaged into the extension.

## Measured corrections

| Detail | Before | Version 0.2.3 |
| --- | --- | --- |
| Model/effort control | Left of the composer footer | Right, beside Send |
| Placeholder | Message Hermes, secondary colour at full opacity | Do anything, tertiary colour at 50% opacity |
| Disabled Send | 30% opacity | 50%, matching the native screenshot |
| Send arrow | 16px public ArrowUp icon | 20px public ArrowUp icon |
| Composer surface | Host secondary surface | Host composer-surface token when present, same fallback |

The existing 98px desktop height, 22px corners, 28px send circle and 8px trailing inset already match the reference and remain unchanged. The column retains the source-backed 768px wrapper and 16px gutters: both screenshot widths fall below its 736px surface maximum, consistent with different available pane space. The cropped image does not establish the exact pane bounds. The editor inherits the host font and weight. Stop retains its 16px glyph. The accessible textarea name remains Message Hermes; submission, Enter/Shift+Enter, IME handling, pending/busy guards and per-conversation model selection are unchanged.

## Checks

- TypeScript passes.
- All **81 Vitest checks** and **nine installer checks** pass; two opt-in live tests are skipped. The existing versioned-resource assertion was updated to 0.2.3. No new visual implementation-mirroring tests were added.
- The self-contained bridge/UI build and `node scripts/verify-plugin.mjs --probe` pass. The MCP probe discovers 14 tools and the global/thread entrypoints without invoking Hermes tools.
- The Impeccable detector was run once on the changed UI files. Its sole warning is the pre-existing 3px Markdown blockquote border, an intentional Markdown convention outside this composer change. The native dim placeholder is deliberately matched to the user's reference; the persistent accessible label and focus treatment remain available.
- Isolated browser acceptance passes in light/dark at 1440×900 and 390×844: empty, typed and multiline drafts, long-model truncation, Power and model-menu bounds, and keyboard focus restoration. The empty desktop composer is 98px high; the retained narrow variant is 100px. Send stays 28px with a 20px arrow and 8px trailing/bottom inset, and the model group sits 8px before it. No horizontal overflow or browser page errors were found.
- The fixture supplies clearly labelled mock profile/model data and performs no Hermes connections or inference. A temporary host-token probe confirms composer-surface and placeholder-tertiary inheritance at 50% opacity. The full-width dark and narrow dark empty screenshots were visually reviewed after verifying an empty textarea value and disabled Send; a stale draft frame from the browser harness was replaced, with no UI source change.
- Final CI evidence is recorded after pushing the implementation.

## Installed package

The guarded replacement and supported `codex plugin add hermes-chatgpt-extension@personal --json` completed at 15:39 UTC. Native listing reports version 0.2.3, installed and enabled. Recoverable source and marketplace backups end in `2026-10-01T15-39-20-078Z-26650b56`. The existing configuration reference and unrelated marketplace entry are preserved.

A fresh bundled Codex app-server process reports Hermes 0.2.3, 14 tools, both theme icons, global/thread entrypoints and app-only model/archive controls. Its read of `ui://hermes/v0.2.3/app-942f4cae4231a6fa.html` matches the exact built HTML. The owned verifier process was closed; no Hermes prompt, setting change or job was invoked.

These assets match between the feature worktree, managed personal source and native 0.2.3 cache:

| Asset | SHA-256 |
| --- | --- |
| dist/server.cjs | f5057fe60b2ab9209cd0d504dcc8daefa3ec9ae7ce28e3d547342cb53b52b1f6 |
| dist/ui.html | 942f4cae4231a6fa6e782c4d82c085cf2e3477cbfd6844a4e512edf88a8af7b8 |
| THIRD_PARTY_NOTICES.md | 476930b1540e59a2c8c3fdff0b9182765ad5efdbe99075ffa04be0a1a173852e |
| assets/nous-girl.png | 8b4a61752b89aade9e176247e262197fa0748603dd7fc03f8b5a3b24a4445184 |
| assets/nous-girl-dark.png | 66d0b49e6fad2f1df68c3788dfd60d694c5261fdf1a55891b0cc1b677024141b |

Package loading and exact-resource transport do not establish that an existing desktop view has refreshed. The permitted MCP Apps inventory returned no expanded app tabs after installation. Opening Hermes through its plugin succeeded, but the current-window app-server proxy did not initialise within the bounded 45-second check. The fresh standalone native app-server check above passes. The user's supplied screenshot remains the native visual reference; the updated composer is verified separately in an isolated browser fixture. No native-window workaround or app restart was used.
