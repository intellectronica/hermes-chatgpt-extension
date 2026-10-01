# UI conventions

The application follows the familiar Codex chat layout using public OpenAI UI components and MCP host styling. It does not redistribute the host application's source or private assets.

- A compact sidebar contains expandable profile sections and chat rows. Profile avatars come from the selected Hermes instance; the app identity uses the licensed Nous images.
- The selected instance name and connection status sit in the sidebar footer. Scheduled opens the jobs view. Narrow layouts use a keyboard-accessible navigation drawer.
- The transcript is centred, with a rounded composer fixed below it. The model/reasoning picker sits beside Send, with a tertiary placeholder and subdued disabled state.
- Chat rows expose Archive on hover or keyboard focus; removal follows acknowledgement and Undo restores the same owned chat. Errors retain the row.
- Host colour, typography, radius and shadow variables adapt the embedded view to its surroundings. Standalone previews use matching light/dark fallbacks. Menus, buttons, Markdown and equivalent action icons use the public Apps SDK UI package.
- Scheduled renders timestamps in the viewer's browser time zone and shows the job's own schedule time zone separately.

Native panels may mask app icons or vary with host version and display mode. Browser screenshots and a successful MCP resource probe establish different facts; verify the actual embedded panel before claiming exact visual parity.

Public references: [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), [OpenAI plugin manifests](https://developers.openai.com/plugins/build/plugins), [Apps SDK UI](https://github.com/openai/apps-sdk-ui), [MCP titles and icons](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md).
