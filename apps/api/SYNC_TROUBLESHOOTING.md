# Sync Pipeline Progress Showing Zero - Troubleshooting Guide

## Problem
When running a full sync, the indexing, extracting, and populating counts show **0/0** instead of the actual document count.

## Root Cause
Documents are being **skipped** because their content hasn't changed since the last sync. The sync pipeline uses SHA256 content hashing to detect changes:

- If `contentHash` matches → document is skipped
- Skipped documents are NOT queued for reprocessing
- Therefore `documentsToProcess` = 0
- Stages 3, 4, 5 complete immediately with 0 items

## Verification
Check if documents were actually processed:

```bash
# Check chunks (indexing output)
docker exec qa-agent-db psql -U qaagent -d qaagent -c "SELECT COUNT(*) FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE source_id = 'YOUR_SOURCE_ID')"

# Check business items (extracting/populating output)
docker exec qa-agent-db psql -U qaagent -d qaagent -c "SELECT COUNT(*) FROM business_items WHERE source_id = 'YOUR_SOURCE_ID'"
```

If you see results (chunks > 0, business_items > 0), then processing DID happen in a previous sync.

## Solution Options

### Option 1: Force Reprocess (Recommended for Testing)
Add `forceReprocess: true` to bypass content hash check:

```bash
# Via API
curl -X POST http://localhost:4000/api/sources/{sourceId}/sync \
  -H "Content-Type: application/json" \
  -d '{"mode": "full", "forceReprocess": true}'
```

Or in the UI, add a "Force Reprocess" checkbox.

### Option 2: Change Document Content
Modify the source documents so their content hash changes, then sync again.

### Option 3: Improve Progress Reporting
Update the sync pipeline to show meaningful progress even when documents are skipped:

```typescript
// In sync.processor.ts, around line 184
await this.sourcesService.setSyncJobMetadata(syncJobId, {
  documentsToProcess: upsertResult.total,  // Use total instead of queued
  documentsQueued: upsertResult.queued,
  documentsSkipped: upsertResult.skipped,
  // ...
});
```

Then update stage progress to reflect:
- If all skipped: show as completed with skip message
- If some queued: show actual processing progress

## Current Behavior vs Expected

### Current (when all documents skipped):
```
Pulling: 12/12 ✓
Processing: 12/12 ✓
Indexing: 0/0 ✓  ← Shows zero
Extracting: 0/0 ✓  ← Shows zero
Populating: 0/0 ✓  ← Shows zero
```

### With forceReprocess=true:
```
Pulling: 12/12 ✓
Processing: 12/12 ✓
Indexing: 12/12 ✓
Extracting: 12/12 ✓
Populating: 12/12 ✓
```

## Implementation Details

The content hash logic is in `documents.service.ts`:

```typescript
// Line 84-90
if (existing) {
  if (!forceReprocess && existing.contentHash === contentHash) {
    // Content unchanged and not forcing reprocess, skip processing
    skipped++;
    total++;
    this.logger.debug(`Document ${doc.externalId} unchanged, skipping`);
    continue;
  }
  // ... queue for reprocessing
}
```

When `forceReprocess=true`:
1. Hash check is bypassed
2. Old chunks are deleted
3. Document is queued to processing queue
4. All stages process the document again

## Quick Fix for UI

Add a "Force Reprocess" toggle to the sync dialog:

```typescript
// In sync trigger UI
<Checkbox
  label="Force Reprocess"
  description="Reprocess all documents even if content unchanged"
  onChange={(checked) => setForceReprocess(checked)}
/>
```

Then pass it to the API:
```typescript
const response = await fetch(`/api/sources/${sourceId}/sync`, {
  method: 'POST',
  body: JSON.stringify({
    mode: 'full',
    forceReprocess: forceReprocess  // From checkbox
  })
});
```

## Testing

To verify the fix works:

1. Run sync with forceReprocess=true
2. Check sync job stages show correct counts
3. Verify chunks and business items are regenerated

```bash
# Trigger sync with force reprocess
curl -X POST http://localhost:4000/api/sources/{sourceId}/sync \
  -H "Content-Type: application/json" \
  -d '{"mode": "full", "forceReprocess": true}'

# Check progress
curl http://localhost:4000/api/sources/{sourceId}

# Verify sync job
docker exec qa-agent-db psql -U qaagent -d qaagent -c \
  "SELECT metadata FROM sync_jobs ORDER BY \"createdAt\" DESC LIMIT 1"
```

### Verification Results ✅

**Test conducted on July 30, 2026:**

Triggered sync with `forceReprocess: true` on source `6df75744-c3e3-4a2b-8b02-136fe0a123e4`

**Before (without forceReprocess):**
```
documentsToProcess: 0
documentsProcessed: 0
Indexing: 0/0
Extracting: 0/0
Populating: 0/0
```

**After (with forceReprocess=true):**
```json
{
  "documentsToProcess": 12,
  "documentsProcessed": 12,
  "documentsExtracted": 12,
  "documentsPopulated": 12,
  "businessItemsExtracted": 114,
  "forceReprocess": true
}
```

**Database Verification:**
- Chunks: 36 (regenerated)
- Business Items: Increased from 17 to 109
- All stages showed proper progress counts (12/12)

**Result: ✅ Solution verified - forceReprocess flag resolves the zero-count issue**

## Summary

**The sync pipeline is working correctly!** The zero counts occur when:
- Documents already exist and haven't changed
- Content hash matches, so they're skipped
- No jobs are queued to processing queue

**Solution**: Use `forceReprocess: true` to bypass hash check and reprocess everything.
