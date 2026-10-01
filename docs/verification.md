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

## GitHub release automation

The release workflow repeats the full checks on Node.js 22 and 24, then publishes the Node.js 22 packages in a separate job. The release tag must match the package, plugin and lockfile versions. The publishing job checks the remote tag's commit, validates the downloaded CI packages, verifies uploaded bytes through GitHub's asset API, and publishes the draft only after all assets match. Existing release assets are preserved; reruns upload only missing files. An already published immutable release must already contain every asset.

For version 0.3.1, local type checking, 101 Vitest checks, 47 Node checks, build, plugin verification and fresh-user ZIP verification passed. Both live Hermes suites remained disabled, the production dependency audit found no known vulnerabilities, and actionlint 1.7.12 accepted both workflows. The updated source ZIP includes 84 files; the runtime ZIP still includes 21.

Thirteen synthetic release checks cover matching metadata, prereleases, draft publication ordering, lightweight and annotated tags, invalid/cyclic tag objects, partial-upload recovery, published-release attachment, immutable reruns, conflicting/incomplete assets, corrupt upload refusal, moved tags and GitHub failures. These tests do not call GitHub.

The first v0.3.0 workflow passed both build jobs but stopped before creating a release because GitHub rejected its commit lookup. Version 0.3.1 uses the explicit Git reference endpoint and peels annotated tags through the Git tag API. A live read-only check resolved the existing annotated v0.3.0 tag to its exact commit.

The [v0.3.1 release workflow](https://github.com/intellectronica/hermes-chatgpt-extension/actions/runs/36912751805) succeeded on commit `bcfeabf8b4b909e405a099c2100e2fb7f0c1404e`: both Node build jobs and the publishing job passed. [Main CI](https://github.com/intellectronica/hermes-chatgpt-extension/actions/runs/36912747849) also passed on that exact commit. GitHub lists [Hermes v0.3.1](https://github.com/intellectronica/hermes-chatgpt-extension/releases/tag/v0.3.1) as its latest stable, published release, with both ZIPs and `SHA256SUMS` uploaded.

The actual GitHub assets were downloaded and independently verified. The 21-file plugin ZIP and 84-file source ZIP both installed and initialised in fresh isolated homes using only Node, without node_modules or a real Hermes target. The downloaded plugin ZIP has SHA-256 `0753da1c970b48aed70ba29abdeb9d6d71760062438bcb6fb1a518540b201e0a`; the source ZIP has SHA-256 `45455850dc593fc2aa494ff1a11ff41eb6676ad2b8aed8d124eb4c65ba8321c8`. These match the release's checksums and GitHub's asset digests. Repository access settings were preserved.
