import { ValidationResult } from './extraction-provider.interface';

export function parseValidationResponse(text: string, contextQuality: number): ValidationResult {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed.isValid !== 'boolean' || !Number.isFinite(parsed.confidence) ||
      parsed.confidence < 0 || parsed.confidence > 100 || typeof parsed.reason !== 'string' || !parsed.reason.trim()) {
    throw new Error('Invalid extraction validation response');
  }
  return { confidence: parsed.isValid ? parsed.confidence : Math.min(30, parsed.confidence), reason: parsed.reason, contextQuality };
}
