# Business Extraction Providers

> Current behavior (2026-09-28): see [Extraction coverage v2](./extraction-coverage-v2.md). The active path supports six bounded evidence-backed proposal types, makes no explanation calls, and fails on provider/configuration errors instead of falling back. Broad-type behavior and accuracy/cost claims elsewhere in this historical guide are not current acceptance results.

## Overview

The business extraction system now supports multiple AI providers for validating and scoring extracted business context items. This allows you to choose between:

1. **Local** (pattern-based, free, no API calls)
2. **OpenAI** (GPT-4 powered, requires API key)
3. **Anthropic** (Claude powered, requires API key)

## Configuration

Set the provider in your `.env` file:

```env
# Provider Options: local | openai | anthropic
EXTRACTION_PROVIDER=local

# Model Options (based on provider):
# - OpenAI: gpt-4o | gpt-4-turbo | gpt-3.5-turbo
# - Anthropic: claude-opus-4-5-20251101 | claude-sonnet-4-5-20250929 | claude-3-5-sonnet-20241022
# - Local: Uses regex pattern matching only (no AI validation)
EXTRACTION_MODEL=claude-sonnet-4-5-20250929

# Provider API Keys (required based on provider choice)
OPENAI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
```

## Provider Comparison

| Feature | Local | OpenAI | Anthropic |
|---------|-------|--------|-----------|
| **Cost** | Free | ~$0.01-0.05 per extraction | ~$0.015-0.075 per extraction |
| **Speed** | Instant | ~1-2s per validation | ~1-2s per validation |
| **Accuracy** | Medium (pattern-based) | High (AI-powered) | Very High (AI-powered) |
| **API Key** | Not required | Required | Required |
| **Offline** | Yes | No | No |

## How It Works

### Architecture

```
DocumentInput
    ↓
BusinessExtractionService
    ↓
ExtractionProviderFactory ─→ Creates provider based on config
    ↓
IExtractionProvider (interface)
    ├─ LocalExtractionProvider (pattern-based)
    ├─ OpenAIExtractionProvider (GPT-4)
    └─ AnthropicExtractionProvider (Claude)
    ↓
ValidationResult { confidence: 0-100, reason: string }
    ↓
BusinessItem (saved with confidence level)
```

### Validation Process

Each provider implements the `IExtractionProvider` interface:

```typescript
interface IExtractionProvider {
  getName(): string;
  validate(request: ValidationRequest): Promise<ValidationResult>;
  analyzeContext(text: string, fullDocument: string): ContextAnalysis;
  scoreToLevel(score: number): 'high' | 'medium' | 'low' | 'inferred';
}
```

#### Local Provider
- Uses **regex patterns** and **heuristics**
- Checks for keywords (must/shall/should for rules, GET/POST for APIs, etc.)
- Analyzes context structure (headings, lists, code blocks)
- No external API calls
- Best for: Quick development, cost-sensitive deployments

#### OpenAI Provider
- Uses **GPT-4** to validate extracted items
- Sends extracted text + surrounding context to OpenAI
- Receives structured JSON validation response
- Falls back to context-based confidence on error
- Best for: High accuracy with OpenAI ecosystem

#### Anthropic Provider
- Uses **Claude** (Opus/Sonnet) to validate extracted items
- Sends extracted text + surrounding context to Anthropic
- Receives structured JSON validation response
- Falls back to context-based confidence on error
- Best for: Highest accuracy, detailed reasoning

### Validation Request

```typescript
{
  text: "User must be authenticated before accessing dashboard",
  fullDocument: "... full document content ...",
  type: "rule" | "entity" | "fact" | "flow" | "requirement" | "testCase" | "api"
}
```

### Validation Response

```typescript
{
  confidence: 85,  // 0-100 score
  reason: "Contains condition (must be authenticated) and clear business rule structure",
  contextQuality: 75  // Quality of surrounding context
}
```

### Confidence Scoring

| Score | Level | Meaning |
|-------|-------|---------|
| 80-100 | `high` | Very confident this is a valid extraction |
| 60-79 | `medium` | Moderately confident |
| 40-59 | `low` | Low confidence, may need review |
| 0-39 | `inferred` | Possibly incorrect, flagged for review |

## Usage Example

### In Code

```typescript
// Automatic - configured via environment variable
const extractionService = new BusinessExtractionService(
  businessService,
  providerFactory
);

// Extract from document (provider is used automatically)
const result = await extractionService.extractFromDocument({
  id: 'doc-123',
  title: 'User Management Requirements',
  content: documentContent,
  type: 'markdown',
  sourceId: 'source-456',
});

// Results include provider metadata
result.items.forEach(item => {
  console.log(`${item.name} - Confidence: ${item.confidence}`);
  console.log(`Provider: ${item.metadata.provider}`);
  console.log(`Reason: ${item.metadata.validationReason}`);
});
```

### Switching Providers at Runtime

```typescript
// Via factory
providerFactory.switchProvider('anthropic');

// Now all validations use Claude
const result = await extractionService.extractFromDocument(doc);
```

## Provider-Specific Features

### Local Provider

- **Fast**: No network latency
- **Type-specific patterns**: Different validation for rules, entities, facts, etc.
- **Context analysis**: Checks for headings, lists, tables, code blocks
- **Keyword matching**: Rule keywords (must/shall), entity suffixes (Model/DTO)

### OpenAI Provider

- **JSON mode**: Uses OpenAI's structured JSON output
- **Type-specific guidelines**: Tailored prompts for each business item type
- **Fallback handling**: Gracefully degrades to context-based scoring on errors
- **Temperature 0**: Deterministic validation for consistency

### Anthropic Provider

- **Advanced reasoning**: Claude provides detailed explanations
- **Type-specific guidelines**: Customized validation rules per item type
- **Robust parsing**: Handles both JSON and markdown-wrapped responses
- **Fallback handling**: Degrades gracefully on API errors

## File Structure

```
apps/api/src/modules/business/extraction-providers/
├── index.ts                            # Exports all providers
├── extraction-provider.interface.ts    # IExtractionProvider interface
├── base-extraction.provider.ts         # Shared context analysis logic
├── local-extraction.provider.ts        # Pattern-based provider
├── openai-extraction.provider.ts       # GPT-4 provider
├── anthropic-extraction.provider.ts    # Claude provider
└── extraction-provider.factory.ts      # Provider factory
```

## Testing

### Test with Different Providers

```bash
# Test with local provider (fast, free)
EXTRACTION_PROVIDER=local npm run dev:api

# Test with OpenAI (requires API key)
EXTRACTION_PROVIDER=openai OPENAI_API_KEY=sk-... npm run dev:api

# Test with Anthropic (requires API key)
EXTRACTION_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npm run dev:api
```

### Sample Output

```json
{
  "type": "rule",
  "name": "User must be authenticated before accessing dashboard",
  "confidence": "high",
  "metadata": {
    "confidenceScore": 85,
    "validationReason": "Contains conditional structure with clear authentication requirement",
    "provider": "anthropic",
    "extractionPattern": "explicit-rule"
  },
  "tags": [
    "auto-extracted",
    "confidence:85",
    "provider:anthropic"
  ]
}
```

## Best Practices

1. **Start with Local** for development and testing
2. **Use AI providers** for production to improve accuracy
3. **Monitor costs** if using OpenAI/Anthropic
4. **Set confidence thresholds** to filter low-quality extractions
5. **Review inferred items** (confidence < 40) manually
6. **Batch extractions** to reduce API calls

## Troubleshooting

### Provider falls back to local

**Issue**: AI provider not being used despite configuration

**Cause**: Missing or invalid API key

**Solution**: 
```bash
# Check API key is set
echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY

# Verify in logs
# You should see: "Initializing extraction provider: anthropic"
# Not: "falling back to local extraction provider"
```

### Low confidence scores

**Issue**: All extracted items have low confidence

**Cause**: Poor document structure or pattern mismatches

**Solution**:
- Improve document formatting (use headings, lists)
- Try different AI provider (Anthropic vs OpenAI)
- Check extraction patterns in source code

### API rate limits

**Issue**: Extraction fails with rate limit errors

**Cause**: Too many API calls

**Solution**:
- Batch document processing
- Use local provider for development
- Implement caching for repeated validations
- Add retry logic with exponential backoff

## Future Enhancements

- [ ] Caching validation results to reduce API calls
- [ ] Batch validation API calls for efficiency
- [ ] Provider-specific configuration (temperature, max tokens)
- [ ] Hybrid mode (local + AI for high-confidence filtering)
- [ ] Custom provider support (Gemini, Llama, etc.)
- [ ] Validation metrics and analytics
