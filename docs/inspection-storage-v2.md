# Inspection draft storage v2

Photo and signature data URLs previously shared localStorage's small string quota with all other staff tools. A full draft list was serialized for every edit, so Chrome on a PC could fail in the same way as an iPhone. New writes now use `baz-inspection-drafts-v2` in IndexedDB.

## Persistence and recovery

- `tasks` contains the form and binary asset references. `assets` stores SHA-256 addressed ArrayBuffers with MIME and byte counts. List rendering reads metadata; opening and cloud sync hydrate one task at a time. Existing 1600px/.8 capture and 800px PDF policies are unchanged.
- `queue` is committed atomically with each task revision. Cloud writes are serialized and acknowledgements cannot discard a newer revision. A delete intention replaces the upsert intention atomically. Network requests have a 30 second deadline.
- `meta` stores verified migration checkpoints, the account's current task, and short-lived open-tab leases. Neither draft content nor current-task recovery requires a successful localStorage write.
- The existing opaque `g:`/`p:` account identifier from the authenticated session partitions drafts; older authenticated sessions fall back to their existing registered staff name. No login token is stored in this database. Account checks also guard network responses. This partition does not replace server authorization.
- Failed writes keep the previous committed task. New/open operations await persistence and retain the current screen on failure. The save indicator reports a committed local draft separately from cloud/PDF status. Revision checks reject stale tabs; reopening refreshes metadata without silently replacing the current form.

## Legacy migration

`inspection_tasks_v1` and the old single draft are copied sequentially to an unassigned partition, including retired slot 3, signatures, Handover references, and PDF receipts. Assets are read back and hashed before an unchanged legacy source is removed. A quota failure rolls back and retries once after allowlisted cache cleanup. Persistent failure preserves the source. Reopening resumes verified work; a changed legacy source is retained as another recovery copy.

Unknown old ownership is never inferred from the current login. Opening an unassigned task asks the user to import it. The original remains preserved, while the adopted task retains its task ID so existing interrupted PDF transfers remain recoverable. Old unowned sync/delete queues remain in localStorage for recovery and are never executed under an arbitrary account.

The independent `baz-inspection-transfers-v1` PDF outbox, upload ID, digest, base revision, owner and Blob/ArrayBuffer remain unchanged. Cleanup reads protected task IDs from this outbox and fails closed when it cannot do so.

## Storage management

The inspection toolbar's **저장 공간** dialog provides usage, current-screen backup, complete/task backups, restore, allowlisted query-cache cleanup, orphan-asset cleanup, and optional persistent-storage permission. Current-screen backup works even when committing a draft fails. Backups are versioned JSON bundles with an integrity digest and editable form/photos/signatures; they contain sensitive work data and must be kept appropriately. Restores are resumable, verified and staged as unassigned work, never uploaded automatically.

Local-only release is separate from business deletion. It requires completed status, no queued write, no protected PDF, no active-tab lease and an exact editable cloud round-trip including photos/signatures and timestamp. A small cloud-only marker prevents the preserved older migration copy from reappearing as the current version. Business deletion keeps its existing explicit confirmation and cloud remove behavior. No completed photo is deleted automatically by age.

The legacy draft endpoint is unchanged. The repository's `inspection_gas.gs` stores draft JSON in a Sheet cell; this change does not assume that an arbitrary photo payload can be recovered from that server. A PDF receipt or an upsert acknowledgement alone never qualifies a draft for release. A missing/truncated/different cloud snapshot blocks local cleanup.

## Verification and operations

`test/browser/inspection-storage.mjs` uses a disposable browser and intercepted synthetic endpoints. Run with Playwright available in node resolution or `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. Set `PLAYWRIGHT_ENGINE=webkit` for WebKit or use the default Chromium/Edge. It covers migration, quota rollback/restart, all old photo slots, pending PDFs, account partitions, stale revisions, backup integrity, local release, full localStorage, async form operations, reload and 100 tasks/600 synthetic photos. `test/browser/inspection-relink.mjs` covers Handover/receipt continuation after async persistence.

Chromium and WebKit automated runs passed on Windows. The 100-task/600-photo fixture uses 16 KB per synthetic photo; its measurements do not represent a physical iPhone or full-size camera-photo workload. Physical-device operation and real authenticated cloud round-trips remain operational follow-up checks.

Do not roll back to an app that only reads localStorage after v2 drafts exist. Retain v2 reading, backup and PDF recovery in any corrective release. Do not delete either IndexedDB database or unverified legacy sources as a rollback step.

Google Apps Script's PDF **lock timeout** is a separate server-side failure. This implementation fixes draft quota/storage behavior and does not claim to remove that server lock contention.
