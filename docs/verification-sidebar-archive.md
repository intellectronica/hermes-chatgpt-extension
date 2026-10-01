# Sidebar filtering and archive verification

Verified on 1 October 2026 for extension 0.2.2 against the installed Hermes checkout `f3394d96cfbccd407a4bebd73b13473af51b0840` on Fnordistan. That installed revision is not a verified public upstream commit. Source inspection, contract tests and live behaviour are separate from native Codex appearance.

## Filtering contract

The bridge reads `/api/profiles/sessions` with an explicit profile, `archived=exclude`, recent ordering and a 100-row page limit. This route is read-only; the ordinary `/api/sessions` route can apply Hermes's configured automatic archiving. Source exclusions for `cron`, `kanban`, `tool` and `oneshot` run before the SQL limit. The bridge also rejects matching `created_source` provenance and archived pinned rows, checks each returned owner and deduplicates IDs. It returns at most 100 eligible conversations within a bounded 500-row candidate window.

The optional bridge setting `sidebar.showAutomatedChats: true` includes tagged automation. Hermes's saved `sessions.show_subagents` setting still governs delegated children; the extension does not edit or bypass that setting. Internally triggered channel wakes retain their channel origin and have no reliable initiator flag in this installed API. Those conversations remain visible; an unknown source is not sufficient evidence of automation.

The default filter returned these live counts, with no tagged automated rows:

| Profile | Visible conversations |
| --- | ---: |
| default | 19 |
| factoryfnord | 3 |
| flashboard | 1 |
| media-mogul | 0 |
| smashcards | 1 |
| stan-ops | 8 |

A separate in-memory configuration with `showAutomatedChats: true` returned 100 factoryfnord conversations, all tagged `cron`. No saved configuration was changed. Installed source evidence came from the REST session routes, session database filters and `tui_gateway/methods_session.py`.

## Reversible archive

Archive and restore call `session.archive` using the owning profile, durable session ID and explicit boolean. Hermes soft-archives the compression lineage and preserves messages. The bridge requires the returned `session_key` and `archived` value to match the request. It does not resume a runtime to archive it. Known active, uncertain, attaching, configuring or question-pending conversations cannot be archived.

The UI uses the [Codex archive control and notification](native-ui-reference.md#archive-controls-and-app-identity). It removes a row only after an owner-matched acknowledgement, rejects stale list responses and preserves other chats and drafts during profile changes. Undo restores the same owner and durable ID. The narrow drawer closes after successful acknowledgement so the notification remains accessible. Failures retain the row and show its error. Store/component/adapter tests cover concurrent list/archive/restore, A→B→A navigation, wrong-owner acknowledgement, failure, pending controls and transcript preservation.

The live check used only the extension-owned controlled echo conversation `20260930_195200_eb86cc`, titled **Test Hermes extension connection**. Before mutation it verified the known echo marker, two user/assistant messages, idle state, zero tools and zero pending questions. Archive was acknowledged and hid it from the sidebar; direct history access preserved the transcript. Restore was acknowledged and returned it to the visible list. A final guarded restore/read-back left its original unarchived state intact.

The role/content transcript SHA-256 remained `5196cf0fc909d17e125caad2bec147de2b95e8691372581ca8e55b6b8b2339e4`. Remote saved configuration/environment/active-profile files retained aggregate SHA-256 `8fe06042fc52863032b20bbd8c1603a6cffdb290918e5803842f389f48b1d956`; the private local bridge configuration retained SHA-256 `d02c19c85e5950664bf7646f793c9195d9a0e48edf654798f69f1e1d37678703`. Contents and credentials were not printed.

An earlier attempt to use a new empty draft stopped before archive: Hermes does not persist an ordinary draft until its first message. No prompt was sent to make it persist. Both checks disposed only their own private backend. The successful run sent no prompts, performed no inference, changed no scheduled jobs and mutated no personal conversations.
