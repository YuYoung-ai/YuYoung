# Delayed Drive completion and attachment recovery

The existing GAS upload handler committed the Drive file, Handover receipt and document outbox, then synchronously delivered up to 20 other queued documents before responding. Slow delivery or a rejected batch could consume the browser's upload deadline after the PDF was already stored. The client did not read back the receipt after an uncertain write; attachment confirmation therefore did not start until the user manually recovered the operation. A local draft callback failure could also stop the chain before server attachment confirmation.

## Changes

- GAS returns the durable PDF receipt after committing the existing document outbox. It no longer waits for the shared delivery batch in the upload response. The existing five-minute worker attempts saved document delivery before source refresh; document failure remains durable and does not stop the other phases. No new trigger, service, database or destination is introduced.
- PDF locks use a bounded three-second acquisition and return `LOCK_BUSY` / `retryable:true` on contention. Shared lock protection, source identity checks, base revision, hash deduplication and metadata-first commit remain intact.
- An uncertain client upload reads back the server receipt up to three times. Only the exact original SHA-256 with the same record can be adopted. It then confirms attachment without sending file bytes again. A newer different revision stops the retry; read-back never replaces the original baseRevision or captured source basis.
- The outbox durably records whether upload was attempted. A manual retry probes the receipt first and preserves the original upload ID/hash/revision. Automatic recovery of an uncertain write only checks metadata; it does not start a second upload.
- Transient attachment failures receive up to two delayed retries within the existing shared 120-second confirmation budget. Deadline exhaustion remains pending. Network/visibility recovery is bounded and never runs an overlapping transfer. The matching current task also restores its outbox operation on reopening.
- Local draft receipt errors no longer prevent server attachment confirmation. The unfinished local checkpoint remains durable and can be repaired without uploading again.
- The completion card shows a pending/verification state until the applicable stages are confirmed. Drive/Handover success remains visible while attachment is pending.

Older deployments' explicit lock-timeout messages remain recognized as transient. Authentication, record identity, deleted comments and newer-document conflicts keep their terminal protections. The browser cannot stop Apps Script by aborting its fetch, so retries check the saved state and retain idempotency identifiers.

## Verification

The inspection regression suite passes all 16 modules. Synthetic tests cover a committed PDF with a lost response, a browser deadline before a late response, delayed projection, reconnect/reload recovery, original upload IDs, local quota callback failure, newer-document rejection, shared confirmation cancellation, short lock contention, immediate GAS receipt and background-worker phase isolation. Chromium/Edge and Windows WebKit mobile flows verify one file upload, attachment completion, and automatic reopening recovery. Handover linking/continuation regression also passes on WebKit.

The live GAS project's two edited modules were first backed up and compared against the repository. Existing deployment version 89 was updated in place to version 90 on 2026-11-10. Existing Code.gs, token library, permissions, web-app URL and other modules are preserved. Tests do not create production hospital records, upload test PDFs, or post test comments. Physical iPhone behavior and individual previously failed business cases are not certified by these synthetic tests.
