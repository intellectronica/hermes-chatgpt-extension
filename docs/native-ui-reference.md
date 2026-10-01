# Native Codex UI reference

Inspected on 1 October 2026 against the installed macOS application, version **26.928.21956** (`/Applications/ChatGPT.app/Contents/Info.plist`). Source defaults are supplemented by the user's native composer comparison below. These are implementation references, rather than a stable public component contract.

The reference is the desktop Codex surface. Browser ChatGPT has different typography, spacing and composer variants. The native application can also change its fonts, zoom, corner scale, theme, opacity and picker choices through preferences or account capabilities. Computer Use access to `com.openai.codex` was denied; the permitted MCP Apps surface separately supplied a native screenshot, loaded-image/font checks and Power menu observation for the earlier profile-rail build. The latest composer comparison comes from the user's supplied screenshot. Full updated native interaction acceptance remains incomplete; evidence and inspection limits are recorded in [verification](verification.md).

## Evidence and supported integration

Static assets were read from `/Applications/ChatGPT.app/Contents/Resources/app.asar`, under `webview/assets/`. Readable copies and original assets live in ignored `work/reference/`; proprietary application code is not included in the repository. Formatting these files only made them readable and did not execute application code.

The [official ChatGPT UI guide](https://developers.openai.com/plugins/build/chatgpt-ui) describes iframe UI through MCP Apps and recommends `@openai/apps-sdk-ui` for host-compatible components. [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines) provide product guidance rather than the exact native desktop metrics below. The extension remains its own Hermes interface inside the host's panel; these sources do not establish support for replacing Codex's native model backend.

The project currently has `@openai/apps-sdk-ui` **0.2.2** installed. Use its public Button, Menu/Popover, Markdown and Icon exports, with local layout styling and the host's supplied CSS variables. Do not import private native application bundles.

## Desktop geometry and typography

These are source-derived defaults, at 100% zoom and the default 14px UI font size.

| Surface | Native source default | Evidence |
| --- | --- | --- |
| Sidebar width | Preferred 275px; clamp from 240px to 520px, constrained to leave 320px for the main pane | `--spacing-token-sidebar` in shared CSS |
| Navigation row | 30px height; 8px horizontal cell padding and outer row inset; 1px between ordinary list rows | `.sidebar-navigation`, `hV` |
| Sidebar sections | 16px section gaps; 8px outer side and bottom padding | `WGr` |
| Section heading | 14px, weight 500, tertiary foreground at 75% opacity; 8px left / 6px right inset | `gV` |
| Section disclosure | 14px glyph; down when open, right when closed; visible when closed or on hover/focus | `eEo`, `.icon-disclosure` |
| Nested chat indentation | 16px per level | `Yuo` |
| Project/row leading icon | 16px | `.icon-xs`, `.icon-leading` |
| Sidebar navigation header | 32px high; 8px leading margin; 4px trailing padding | `QGr` |
| Transcript outer column | 768px normal maximum width; desktop's 16px wrapper gutters leave 736px inside; 896px token for wide Markdown blocks | `--thread-content-max-width`, `tCr`, `--markdown-wide-block-max-width` |
| Main toolbar padding | 16px | `--padding-toolbar` |
| Normal desktop composer surface | Maximum 736px: same 768px constrained wrapper as transcript, with 16px gutters per side | `tCr`, default `ThreadScrollLayout` footer |
| Adjacent/home alignment tokens | Overhang token 24px; home inline inset 13px; adjacent maximum width evaluates to 790px. These do not establish the visible chat composer width | Shared CSS formulas / adjacent toasts and suggestions |
| UI font | System sans: `-apple-system`, BlinkMacSystemFont, Segoe UI, sans-serif | `--font-sans-default` |
| UI sizes | Base 14px; small controls 13px; extra small 12px | Electron CSS and default `sansFontSize: 14` |
| UI weight | Default 430; medium 500 | Electron CSS |
| Chat text | Default 14px; Markdown line height 1.625 × font size; user configurable | Appearance defaults / `.MarkdownRoot` |
| Spacing unit | 4px | `--spacing: .25rem` |
| General corners | xs 5px / sm 7.5px / md 10px / lg 12.5px / xl 15px, after the desktop's default 1.25 corner scale | Base radii and `--codex-corner-radius-scale` |

Native sidebar item rounding uses `--radius-lg`; the sidebar also defines a separate 10px row token used by other row variants. Do not assume that every native row uses the same corner variable.

For the chosen normal desktop chat, use the default constrained transcript/footer composition. The shared `tCr` wrapper has `width: 100%`, automatic side margins, maximum width `T + 2B` and `px-toolbar` padding. Here `T` is `--thread-content-max-width` (768px), `B` is `--thread-body-inline-padding` (fallback 0 for Electron), and toolbar padding `P` is 16px. With sufficient pane space, the outer wrapper is 768px and its inside is `768 - 2 × 16 = 736px`; the visible composer fills that inside. More generally its width is `min(pane width, T + 2B) - 2P`. Its internal 12px editor padding does not reduce the outer surface's width. A 768px wrapper with 24px gutters would instead produce a 720px surface.

The browser variant defines `B = 16px`, giving an 800px outer wrapper and 768px inside. Home and compact layouts have other composition paths. Do not infer the normal desktop composer width from the 24px alignment token or 790px adjacent maximum: the latter is used for adjacent surfaces such as toasts. The packaged normal desktop composer root/surface has no compensating negative margin or extra width in the inspected path.

Width source locations in the ignored readable copies: `app-initial-135a4ef2552c.js.readable:67449` defines `tCr`, exported as `zJt`; `thread-scroll-layout-6554245fc75e.js.readable:3` imports it as `be`, uses it for the default footer at lines 444–446 and constrained transcript at line 449. `app-primary-83ab2f0c1a5c.js.readable:20107` defines the adapter's `min-w-0` outer class; its native surface is passed through `a4e` at lines 11922–11952. Shared CSS supplies `T`, `P` and the browser-only `B` override. This is the source default, with active GUI preferences still unverified.

Native project rows use title clicks to toggle expansion in the ordinary project list. Selecting a profile and expanding its chats together is an intentional Hermes adaptation. Give the profile and chat rows separate ownership/state: selecting a chat must retain its original profile. Native selected rows use a subdued ghost-hover surface and `aria-current="page"`; focus uses a visible two-pixel ring. Section actions appear on hover/focus/open menus, and remain available on touch devices. Use semantic buttons and `aria-expanded` for disclosures.

## Composer and transcript

The user's 1 October side-by-side image is 3566×382 pixels. Both 56px send circles imply a 2× capture. Its native and Hermes composer corners trace the same edge, and both surfaces are 196px high: 98 CSS pixels, with 22px corners, 28px controls and an 8px trailing inset. Preserve these matching dimensions.

The visible differences are the model/effort control on Hermes's left instead of the native trailing group, placeholder ink of `#7d7d7d` instead of `#4c4c4c`, and disabled-send fill of `#5c5c5c` instead of `#848484`. Native placeholder CSS inherits the editor font and applies the tertiary colour at 50% opacity; the disabled-send control also uses 50% opacity. The native arrow's ink occupies 20×22 capture pixels versus Hermes's 16×18; using the public 20px ArrowUp icon closes this gap. The native surface is `#1a1a1a` versus Hermes's `#191919`; prefer `--color-background-composer-surface` when the host exposes it, retaining the existing elevated-surface fallback.

Version 0.2.3 applies those measured corrections and the native “Do anything” placeholder. The textarea retains its accessible Message Hermes label. Unavailable voice, attachment and access controls are not added by this visual refinement. Verification of the updated standalone renders and installed resource is recorded in [composer verification](verification-composer.md).

| Detail | Default desktop | Other source variants |
| --- | --- | --- |
| Composer outer radius | 22px, round | Large/browser 28px; compact uses a general radius |
| Editor minimum height | 44px | Compact 20px; home can require more rows |
| Editor line height | 20px | Browser follows chat text; dictation can use 24px |
| Text inline padding | 12px | Browser has larger padding |
| Gap before footer | 4px | Browser variant differs |
| Footer side / bottom inset | 8px / 8px | Browser bottom 9px |
| Circular composer control | 28px | Comfortable 32px; browser/dictation 36px |
| Model/effort trigger | 13px / 18px line height; 8px inline padding; ghost surface; full rounding | Can collapse to an icon when space or presentation requires |
| Regular user bubble | Right aligned; max 70% width; 16px inline / 10px block padding; 22px radius | Leading user bubbles can occupy 100% |
| Compact user bubble | Max 456px; 12px inline / 8px block padding; 16px radius | Activated by the compact/Aeon formatting path |

The ordinary user bubble colour is a 5% foreground tint. The compact variant has a separate theme colour. Use plain, left-aligned assistant Markdown as the Hermes counterpart of the normal Codex response body. The inspected Markdown body renders content directly and does not add a repeated assistant name/avatar heading. Full transcript composition and its active variant remain unverified; profile avatars belong in the sidebar/header, while specialised agent attribution may need its own treatment.

The native source does not support treating all these variants as one fixed pixel layout. Pick the standard desktop composition for Hermes and keep narrow layout, text growth, focus, reduced motion, scrolling and the host's resize behaviour intact.

## Chosen model and reasoning selector

Use the **current Power picker composition**, with real Hermes model and effort data. Do not reproduce the previous temporary model list plus permanent effort submenu as if it were the current desktop control.

`LW` initialises the menu view to `simple`. The combined labelled picker is used when model/effort adjustment is allowed and the label is visible. The picker falls back to its model list when fewer than two usable Power choices exist. Account/model catalogues and an extra-high filtering experiment affect the choices; no dedicated on/off Power flag is evident in this component. This establishes the packaged default path, not the active account's GUI flags.

### Closed trigger

- One ghost button containing the model name, subdued effort label and downward indicator.
- Model/effort groups use 4px gaps. The model label truncates while the effort remains visible as space allows. The standard combined content caps at 256px.
- The button exposes `aria-expanded`, `aria-haspopup="menu"`, the selected reasoning effort and a Select model tooltip. Opening the simple picker can show Select effort for an explicitly selected model.

### Open simple view

The popup is 254px wide with an 8px trigger offset. The current component centres its popup relative to the trigger through an alignment adjustment. It uses a thin 0.5px ring, an elevated theme surface and overlay shadow. Its inner panel has 4px padding.

The first row is centred and at least 36px high. Normally it shows model and effort together, at 14px medium weight. For an explicit model selection it places the effort above the model; the model becomes 12px secondary text. A right-facing chevron accompanies the selected label. Clicking this row, accessible as Select model, opens the model list. There is no separate Advanced label in the current component.

The current `ViewControls` also includes a **Reset to default** icon action when a reset callback is available and the selection is unlocked. It sits on the right of the selected row, with a 32px target and an accessible label/tooltip. The picker supplies its disabled state; the native Ultra warning temporarily hides the action. Activation keeps the menu open and restores the default selection. Hermes can use this real control to restore the owning profile's defaults for the current chat.

Below it is the graphical Power control:

| Part | Exact source geometry |
| --- | --- |
| Outer slider container | 32px high; 2px inline margin; 2px block / 6px inline padding |
| Slider root | 28px high |
| Track | 24px high; 12px radius; 10% foreground tint; inset 0.5px border |
| Filled range | Blue theme colour; follows the selected position |
| Discrete ticks | 4px circles, evenly spaced at `index / (count - 1)`; 16px hit area; hover scales to twice the size |
| Thumb | White 28px circle; 0.5px strong border; small shadow; 34px hit area |
| Motion | Usual selection transition 300ms; reduced motion removes animation |

Map the slider positions to the **currently selected Hermes model's actual supported effort levels**. Native Codex can use recommended model-and-effort bundles, locked choices, speed controls and a purple maximum effect; those features must only appear for corresponding real Hermes capabilities. Inherit profile defaults and clearly represent an explicit per-chat override. Do not invent a recommendation catalogue or claim that Hermes has Codex's quota/speed rules.

Pointer changes preview/select positions, with commit and cancellation hooks. The keyboard control announces value and position; Left/Right adjusts and commits, Enter completes/closes, and menu navigation uses Tab/Shift-Tab/Up/Down. Native max-state particle effects are decorative and obey reduced motion. The native Power label is primarily accessible rather than a separate visible heading above the slider.

### Model list view

- Heading: Select model. No model search field appears in this inspected implementation.
- Scrollable model list: maximum 316px, further constrained by available popup height. Inner horizontal padding is 4px.
- Models use radio menu semantics (`aria-checked`) and a right-hand check for the selected option. Native Default has a recommendation description; Hermes should describe its profile default accurately.
- Selecting a model or Default prevents immediate dismissal and switches back to the simple effort view. When changing model, retain the old effort if it remains supported, otherwise use that model's default.
- There is no permanent Back button in the inspected view. Selection returns to the slider. Native optional account footer/access controls are capability dependent.
- View changes animate height in 320ms and opacity in 200ms, with reduced motion disabling these transitions. Inactive views are inert and hidden from assistive technology. Focus moves to the chosen radio item or first usable menu item.

For direct source inspection, the readable primary file contains the Power keyboard/commit component at lines 10204–10292, selected-row control at 10436–10510, simple/advanced layout at 10511–10649, combined trigger/popup at 10785–10847 and default branching at 11194–11248. These numbers refer only to the ignored formatted copy.

## Host theme variables

`mcp-app-host-styles-a3d0db3a479e.js` resolves the native root's computed styles and maps them into the iframe's generic MCP Apps variables. Prefer these resolved variables over assuming the desktop defaults:

| Supplied iframe variable | Native source mapping |
| --- | --- |
| `--color-background-primary` | Main application surface |
| `--color-background-secondary` | Elevated surface |
| `--color-background-tertiary` | Under/secondary surface |
| `--color-text-primary` | Native foreground |
| `--color-text-secondary`, `--color-text-tertiary` | Native description foreground |
| `--color-border-primary` | Primary outline |
| `--color-border-secondary`, `--color-border-tertiary` | Native border |
| `--font-sans`, `--font-mono` | Resolved host font families |
| `--font-weight-normal`, `--font-weight-medium` | Native UI weights |
| `--font-text-xs-size`, `--font-text-sm-size`, `--font-text-md-size`, `--font-text-lg-size` | Resolved native xs/sm/base/lg sizes |
| `--border-radius-xs` through `--border-radius-xl` | Resolved native `--radius-*` corner sizes, including scale |
| Shadow variables | Resolved native small/medium/large shadows |

Baseline native light/dark main surfaces are `#ffffff` / `#181818`, under surfaces `#f9f9f9` / black, and opaque editor/elevated dark surfaces `#212121`. Translucency and theme preferences can change the resulting values; these are not evidence that the active native sidebar visibly uses black. Generic iframe token names do not expose every native sidebar/composer-specific token. Use conservative fallback styling for standalone mode and preserve the host values when embedded.

## Archive controls and app identity

Codex's chat sidebar exposes a direct **Archive chat** button on row hover or keyboard focus. The Work surface has a different overflow-menu variant; the Hermes sidebar uses the Codex variant. Its target is 20×20px, its public Archive glyph is 14px, and it uses a top tooltip with the same accessible label. The action rail is 52px wide with 6px end padding, a 2px margin and 8px gap. The title reserves 36px for the visible action. Activation stops propagation so it does not open the conversation.

Native feedback reads **Archived chat**, offers **Undo**, and disappears after five seconds. The notification is centred at the top of its registered pane bounds, inset by 8px, with a conditional 40px toolbar spacer. The ordinary in-pane header path reserves that space; the native-titlebar path does not. Hermes has its own in-pane header, so its notification belongs 8px below that actual header. Native notifications use an intrinsic width constrained to 790px, 12px horizontal/8px vertical padding, 1px border, 15px corners, 14px text and a minimum 42px height. Close has a 24px target. The timer pauses on hover, pointer interaction and a hidden document. Hermes also pauses on keyboard focus. Successful restoration reads **Chat restored**. Native View links to an archived-settings destination; Hermes has no such destination, so that action is omitted.

Source locations in the ignored readable copies: `app-initial-135a4ef2552c.js.readable:133326–133345`, `138589–138612` (control), `133438`, `133483`, `133676–133678` (geometry), `137061–137067`, `110713–110720` (feedback), `76216–76217`, `76248–76272`, `79996`, `80143–80146` (placement and conditional toolbar reservation); `app-shared-eececb2d2eb0.js.readable:124994–125019`, `55108`, `79166–79182`, `79286–79294`, `79412–79415` (notification styling, duration, pause and close).

The installed host resolves app titles from the tool title before annotations or the RPC name. It resolves app icons from tool icons, falling back to server information, and accepts HTTPS or data URLs there. The current SDK's registered tools do not emit top-level icons; Hermes supplies two theme-specific PNG icons in server information. Plugin listing/composer logos use relative manifest asset paths. The current global/thread entrypoint renderer masks these icons to a monochrome foreground, so the Nous girl identity is supplied without promising its original colours in every host surface. Public contracts: [plugin icon requirements](https://developers.openai.com/plugins/deploy/submission#icons-and-screenshots), [manifest path rules](https://developers.openai.com/plugins/build/plugins#path-rules), [MCP titles](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#titles) and [MCP icons](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#icons).

## Asset provenance

All paths below are relative to `webview/assets/` within the application archive. SHA-256 hashes are for the original bytes. They identify this reference build without redistributing its code.

| Asset | SHA-256 |
| --- | --- |
| `app-initial-135a4ef2552c.js` | `8d0cf4d91cf95805808464d43e06ab3106e03924b4f51020e20f143553e746c3` |
| `app-initial-e55cd978d577.css` | `4467a7668c346b181d2f965e19676a47e76fe8a9c3f08676bfa9af4d35a840b9` |
| `app-shared-342447930c78.css` | `916d8fa55c82aedbf6ca0f53eec06274ec9eafe08397bb7e9e495d089781f93d` |
| `app-primary-83ab2f0c1a5c.js` | `9de94aa38d430a80895ee121407819910d9dca0edcbbd7b90f8ca69e94c9bde3` |
| `app-primary-547a6c7b4fb3.css` | `658cc9377542b4d04ade79be0ae4f520d9695008cd72fb6db8af58d91d1e0cdd` |
| `impl-73fde6f53d44.js` | `015c46a09f12f11b7c67a3972e1c00b0ba661a886a88ce0867481ae7d2512915` |
| `impl-1c8b0a94e9ce.css` | `9bee384ca55c01186f1e1afdb6e28052fb68807f8b1d550cc959d23e88f847c6` |
| `mcp-app-host-styles-a3d0db3a479e.js` | `e9bd9f6e08ce3098356b3db3a43bb1cdc66dd15b70ce4ab10bc8f841bb3a99ce` |
| `thread-scroll-layout-6554245fc75e.js` | `4192c606520410e2d6e68352967c524d4bc222071d3ac14b150828fc88685ec5` |
| `user-message-5f36f8af4dd8.js` | `64705bdbe9a13562fc6335e57750c57680165a52e13db758e1d39278620a7738` |
| `user-message-f152e09d34c3.css` | `25ad82aec4bf9cca733ca538de34fe765ba0c1efa00883bad870044881b2624c` |

Public SDK component counterparts include Button, Menu/Popover and Markdown. Public icon exports include ArrowUp, ChevronDown, ChevronRight, Plus, Check and Clock variants. Use the public icons for equivalent actions, sized to the metrics above; privately bundled SVG paths have not been copied into this document. The native Power slider requires local composition rather than an assumed public component export.

## Verification boundaries

Confirmed: installed application version, static component composition, source defaults, asset hashes and host-token mappings. Unverified: the active account's feature flags, exact rendered measurements after user preferences, and the final Hermes UI inside the native panel. A standalone browser check can establish layout and interaction behaviour, but does not establish a native-panel match. Parent task owns the actual embedded UI verification and final screenshots.
