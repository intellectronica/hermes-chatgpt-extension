# Verification

Run from a source checkout with Node.js 22 or newer:

```sh
npm ci
npm run check
npm test
npm run build
npm run plugin:verify
npm run release:package
npm run release:verify
```

The ordinary suite uses synthetic fixtures for HTTP/WebSocket authentication, connection and profile isolation, session ownership, model/effort confirmation, reconnect ambiguity, safe presentation, archive/restore, filtering and UI interactions. It does not connect to a real Hermes instance. Installer tests use temporary homes and check configuration privacy, marketplace preservation, symlink rejection, concurrent changes and recoverable replacement.

The build parses the final inline UI script and exports dependency licence notices. Plugin verification initialises the compiled MCP server and reads tools/resources without executing a Hermes action. Release verification extracts the ZIP into a fresh path with spaces, installs into an isolated home, checks that private config is referenced without being copied, and probes the installed server without a source checkout or node_modules.

## Optional live compatibility tests

Live tests are skipped unless explicitly enabled. Configure a disposable or authorised target using HERMES_LIVE_SSH_HOST, HERMES_LIVE_REPO, HERMES_LIVE_PYTHON and HERMES_LIVE_HOME; HERMES_LIVE_SSH_USER is optional when an SSH alias or local username supplies it. There are no default hosts or private paths.

HERMES_LIVE_SSH_TEST=1 enables metadata reads through an owned managed backend. HERMES_NATIVE_LIVE_TEST=1 additionally creates an empty test conversation and changes its model/reasoning settings. Neither test submits inference or runs scheduled jobs. The latter leaves the empty conversation in the selected profile; use an isolated target when that matters. Both close their owned backends and require existing dependencies.

## UI and compatibility acceptance

For UI changes, inspect light/dark views at wide and narrow sizes, keyboard navigation, focus restoration, errors and empty states. A browser preview cannot establish native host rendering. The MCP resource URI contains the project version and content hash to avoid stale templates; the desktop host may still require its documented plugin refresh flow.

HTTP integration requires Hermes's desktop backend endpoints and compatible JSON-RPC methods. A plain messaging gateway or OpenAI-compatible completion endpoint does not supply these contracts. Feature availability also depends on the chosen Hermes revision, profile configuration and provider. Test against each supported upstream revision before claiming broader compatibility.

CI runs type checking, ordinary tests, build, plugin verification, production dependency audit and fresh-user release verification. Release archives include complete licences and an integrity manifest, while excluding Git history, configuration, environment files and local development artefacts.

## Release 0.3.0 acceptance

Local type checking, 101 Vitest checks, 34 Node checks, build, plugin verification and fresh-user release verification passed. The two real-Hermes suites remained explicitly disabled. Production dependency audit reported no known vulnerabilities at the time of this check.

Both the 21-file plugin ZIP and 81-file source ZIP installed in fresh, isolated homes using only Node and initialised the compiled MCP server with 14 tools and its UI resource. Private configuration was referenced without being copied; the source manifest was preserved. The source archive includes complete code and tests with no prior Git history. Checksums and per-file manifests are generated with each package.

Synthetic managed-supervisor checks covered existing venv/.venv and explicit interpreter paths, missing server-dependency refusal before Hermes startup, and owned-child cleanup. Fixture integration verified colliding session IDs on separate instances retain their owners for model and archive actions. Neither check accessed a real SSH host or Hermes installation.

Standalone browser checks at 1440×900 and 390×844 in light/dark themes verified the viewer-time-zone label and the distinct job schedule zone, with no page overflow or page errors. These fixture renders do not establish a native host embedding or live backend compatibility claim.

CI independently repeats the checks on Node.js 22 and 24 and uploads the two allowlisted archives and SHA256SUMS. See the [workflow results](https://github.com/intellectronica/hermes-chatgpt-extension/actions/workflows/ci.yml) for the exact pushed commit.
