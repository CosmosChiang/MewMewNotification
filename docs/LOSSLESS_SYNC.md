# Lossless Notification Synchronization

Notification synchronization uses an API page size of 100 independently from the popup display limit and the 100-record history retention limit. Redmine results are requested with deterministic `updated_on:asc,id:asc` ordering, `status_id=*`, and increasing offsets until `total_count` is consumed.

## Cursor and replay

The version 1 cursor stores a watermark, recent event identities, an unfinished reconciliation queue, and the last full-reconciliation timestamp. Incremental queries begin two minutes before the committed watermark to tolerate equal timestamps and clock skew. Events use profile ID, issue ID, and `updated_on` as their stable identity; issue snapshots and notification record IDs make overlap replay idempotent.

The cursor is the final persistence write. Issue snapshots, read effects, retained history, reconciliation results, and seen IDs must all succeed first. A failed earlier write leaves the old cursor intact, so the next run safely replays the overlap.

## Reconciliation

Previously tracked issues missing from assigned or watched results enter a persistent bounded queue. At most 20 are fetched directly per run. Closed and reassigned issues pass through the same status, assignee, project, quiet-hour, and bundling policy as primary results. HTTP 404 and 403 become a stable generic unavailable tombstone and are not repeatedly delivered.

A bounded full reconciliation runs at most once per 24 hours to repair drift. Unfinished IDs remain in the cursor queue for the next run.
