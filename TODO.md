# Automatic GitHub releases

- [x] Add a version-tag release workflow that tests, builds and verifies the distributable archives.
- [x] Implement publishing of the installable ZIP, source ZIP and checksums; reject mismatched versions and unsafe reruns.
- [x] Document downloads and the release process, and include the workflow in source archives.
- [x] Pass local checks and GitHub CI, then verify a real release and its downloaded assets.

# Shareable MIT release

- [x] Audit current files and Git history; identify private setup notes in older commits.
- [x] Remove personal deployment notes, explicit live-test defaults and fixed display time zone from the current tree.
- [x] Add MIT licensing and self-contained installation, configuration and usage documentation.
- [x] Complete portable multi-instance SSH/HTTP configuration and its tests.
- [x] Generate dependency licence notices and allowlisted plugin/source ZIPs without Git history or private configuration.
- [x] Verify fresh-user installations, pass local tests/build/package checks and record release evidence.

CI checks every pushed commit on Node.js 22 and 24; its status is recorded by the workflow rather than a static checklist.

# Future work

- Hosted ChatGPT distribution and authenticated remote MCP deployment.
- A UI setting for including automated chats, and a view of archived chats.
- Scheduled-job management after an explicit scope decision.
- Native-panel acceptance for each supported host version; browser and MCP probes alone do not establish it.
