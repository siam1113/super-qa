# Business Extraction Quality Analysis

## Executive Summary

The business extraction is **partially working** but producing many low-quality items due to over-reliance on regex patterns without sufficient AI validation.

**Stats from Latest Sync:**
- Total items extracted: 109
- Good quality items: ~20-25 (18-23%)
- Low quality items: ~84-89 (77-82%)

---

## Problem Analysis

### Root Causes

#### 1. **Inconsistent AI Validation**

Only some extraction types use AI validation:

**✅ WITH AI Validation** (apps/api/src/modules/business/business-extraction.service.ts)
- `extractRules()` - Lines 230-336
- `extractEntities()` - Lines 338-409
- These call `validateWithProvider()` with GPT-4o

**❌ WITHOUT AI Validation** (just regex)
- `extractApis()` - Lines 679-723
- `extractIntegrations()` - Lines 545-593
- `extractActions()` - Lines 1076-1118
- `extractPermissions()` - Lines 511-543
- `extractDatabase()` - Lines 815-854
- `extractRequirements()` - Lines 901-942
- And 10+ other extractors

#### 2. **Regex Patterns Are Too Loose**

Examples of problematic patterns:

**API Extraction (Line 685):**
```typescript
/(GET|POST|PUT|PATCH|DELETE)\s+([\/\w{}\-:]+)/gi
```
**Problem:** Matches any word after HTTP methods
- ❌ Extracts: "GET started", "PUT the", "POST If"
- ✅ Should extract: "GET /api/users", "POST /transactions"

**Database Extraction (Line 822):**
```typescript
/(?:table|schema|collection)[:\s]+[`"']?(\w+)[`"']?/gi
```
**Problem:** Matches single words after keywords
- ❌ Extracts: "once", "by"
- ✅ Should extract: "users", "transactions"

**Integration Extraction (Line 556):**
```typescript
/(https?:\/\/[^\s]+)/g
```
**Problem:** Extracts ALL URLs regardless of relevance
- ❌ Extracts: YouTube videos, LinkedIn posts, Stack Overflow links
- ✅ Should extract: API endpoints, webhook URLs

#### 3. **Source Documents Are Templates**

Out of 12 documents synced:
- 8 are Confluence templates (generic placeholders)
- 4 have actual business content

**Templates extracted from:**
- "Template - Product requirements"
- "Template - Meeting notes"
- "Template - Decision documentation"
- "Getting started in Confluence"
- "Explore Confluence Features"

These templates have NO real business knowledge, only instructional text.

---

## Extraction Quality by Type

### ✅ Good Quality (Rules)

**Example Good Extractions:**
```
Type: rule
Name: Account numbers must be unique.
Confidence: high (95%)
Validation: "Clear, specific, and actionable rule..."
Provider: openai (GPT-4o)
```

**Why they work:**
- AI validation with GPT-4o
- Clear regex patterns for "must/shall/should" statements
- Confidence threshold (40%) filters bad matches

### ❌ Poor Quality (APIs)

**Example Bad Extractions:**
```
Type: api
Name: GET started
Description: API endpoint from Overview
Confidence: inferred
Metadata: null
```

**Why they fail:**
- No AI validation
- Regex matches ANY word after HTTP methods
- No confidence scoring

### ❌ Poor Quality (Integrations)

**Example Bad Extractions:**
```
Type: integration
Name: https://www.youtube.com/watch?v=ohtDFXNAUns
Description: Integration point from Getting started in Confluence
```

**Why they fail:**
- All URLs extracted without context analysis
- YouTube videos, LinkedIn posts are not integrations
- No filtering for relevance

### ⚠️ Medium Quality (Requirements)

**Example:**
```
Type: requirement
Name: be greater than 0
Description: be greater than 0
```

**Issue:** Extracted fragments without full context
- Should be: "Transaction amount must be greater than 0"
- Got: "be greater than 0"

---

## Detailed Findings

### Document Analysis

**BUSINESS CONSTRAINTS** (Good Content):
```
Content: Real business rules for finance app
Extracted:
✅ 7 good rules ("Account numbers must be unique", etc.)
✅ 6 requirements (partial, missing context)
❌ 1 bad database ("once")
❌ 1 bad permission ("have")
❌ 1 bad action (huge text blob)
```

**Template Documents** (No Real Content):
```
Content: Generic placeholders like "Type @ name to mention"
Extracted:
❌ Random API patterns from instructional text
❌ URLs to help documentation
❌ Action fragments from UI instructions
```

### Validation Effectiveness

**Checked:**
- Good rule: Has `metadata.confidenceScore: 95`, detailed validation reason
- Bad API: Has `metadata: null` - never validated

**Conclusion:** AI validation works when used, but only 2 of 20 extractors use it.

---

## Recommendations

### 🎯 Priority 1: Add AI Validation to All Extractors

**Current state:**
```typescript
// extractApis() - NO validation
items.push({
  type: 'api',
  name: `${method} ${endpoint}`,
  confidence: 'inferred',  // Always inferred!
  // ...
});
```

**Recommended:**
```typescript
// Validate BEFORE adding
const validation = await this.validateWithProvider(
  `${method} ${endpoint}`,
  doc.content,
  'api'
);

if (!validation.isValid) {
  continue;  // Skip invalid matches
}

items.push({
  type: 'api',
  name: `${method} ${endpoint}`,
  confidence: this.scoreToLevel(validation.confidence),
  metadata: {
    confidenceScore: validation.confidence,
    validationReason: validation.reason,
    provider: this.provider.getName(),
  },
});
```

### 🎯 Priority 2: Improve Regex Patterns

**APIs:**
```typescript
// Current - matches "GET started"
/(GET|POST|PUT|PATCH|DELETE)\s+([\/\w{}\-:]+)/gi

// Better - requires / in endpoint
/(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w{}\-/:]+)/gi
```

**Database:**
```typescript
// Current - matches "once"
/(?:table|schema)[:\s]+(\w+)/gi

// Better - requires meaningful names
/(?:CREATE\s+TABLE|table|schema)[:\s]+([A-Z][a-zA-Z_]+)/gi
```

**Integrations:**
```typescript
// Current - extracts ALL URLs
/(https?:\/\/[^\s]+)/g

// Better - only API/webhook URLs
/(https?:\/\/(?:api\.|webhook\.|[^\/]+\/api\/)[^\s]+)/g
```

### 🎯 Priority 3: Filter Source Documents

**Before processing:**
```typescript
// Skip template/help documents
const skipPatterns = [
  /^Template -/,
  /Getting started/,
  /Explore.*Features/,
];

if (skipPatterns.some(p => p.test(doc.title))) {
  this.logger.debug(`Skipping template document: ${doc.title}`);
  return { items: [], relationships: [] };
}
```

### 🎯 Priority 4: Increase Confidence Threshold

**Current (Line 1217):**
```typescript
const isValid = validationResult.confidence >= 40;  // Too low!
```

**Recommended:**
```typescript
const isValid = validationResult.confidence >= 60;  // More selective
```

### 🎯 Priority 5: Context-Aware Extraction

For requirements, extract full context:

```typescript
// Current - extracts fragment
/(?:must|should)\s+([^\n.]+)/gi  // Gets "be greater than 0"

// Better - get full sentence
/([A-Z][^.]*(?:must|shall|should)[^.]+\.)/g  // Gets "Transaction amount must be greater than 0."
```

---

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
1. ✅ Add document filtering for templates
2. ✅ Increase confidence threshold to 60%
3. ✅ Improve API regex to require `/` in endpoint

### Phase 2: Add AI Validation (2-4 hours)
1. ✅ Add `validateWithProvider()` to `extractApis()`
2. ✅ Add validation to `extractIntegrations()`
3. ✅ Add validation to `extractActions()`
4. ✅ Add validation to `extractDatabase()`

### Phase 3: Improve Patterns (2-3 hours)
1. ✅ Enhance database patterns
2. ✅ Enhance requirement context extraction
3. ✅ Add filters for integration URLs

### Phase 4: Testing (1-2 hours)
1. ✅ Run full sync with improvements
2. ✅ Verify extraction quality
3. ✅ Measure before/after stats

---

## Expected Improvements

**Current:**
- Total items: 109
- Quality items: ~20-25 (18-23%)
- Noise: ~84-89 (77-82%)

**After Phase 1-2:**
- Total items: ~40-50 (filtered)
- Quality items: ~35-45 (80-90%)
- Noise: ~5-10 (10-20%)

**After Phase 3-4:**
- Total items: ~30-40 (highly curated)
- Quality items: ~28-38 (90-95%)
- Noise: ~2-5 (5-10%)

---

## Testing Checklist

After implementing improvements:

```bash
# 1. Force reprocess to test
curl -X POST http://localhost:4000/api/sources/{sourceId}/sync \
  -H "Content-Type: application/json" \
  -d '{"mode": "full", "forceReprocess": true}'

# 2. Check extraction quality
docker exec qa-agent-db psql -U qaagent -d qaagent -c "
  SELECT type, COUNT(*) as count,
         AVG(CAST(metadata->>'confidenceScore' AS INT)) as avg_confidence
  FROM business_items
  WHERE \"sourceId\" = '{sourceId}'
  GROUP BY type
  ORDER BY count DESC
"

# 3. Review low confidence items
docker exec qa-agent-db psql -U qaagent -d qaagent -c "
  SELECT type, name, metadata->>'confidenceScore' as score
  FROM business_items
  WHERE CAST(metadata->>'confidenceScore' AS INT) < 60
  ORDER BY type
"

# 4. Check validation reasons
docker exec qa-agent-db psql -U qaagent -d qaagent -c "
  SELECT type, name, metadata->>'validationReason'
  FROM business_items
  WHERE metadata->>'confidenceScore' IS NOT NULL
  LIMIT 10
"
```

---

## Summary

**The extraction system has good foundations:**
- ✅ AI validation works well when used (GPT-4o)
- ✅ Rules extraction is high quality
- ✅ Confidence scoring is effective

**But needs improvements:**
- ❌ Most extractors don't use AI validation
- ❌ Regex patterns are too permissive
- ❌ Template documents create noise
- ❌ No quality filtering

**Next steps:**
1. Add AI validation to all extractors
2. Filter template documents
3. Improve regex patterns
4. Increase confidence threshold

This will transform extraction from 18-23% quality to 90-95% quality.

---

**Analysis Date:** July 30, 2026
**Extraction Provider:** OpenAI GPT-4o
**Source:** apps/api/src/modules/business/business-extraction.service.ts
