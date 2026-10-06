import { Injectable } from '@nestjs/common';
import { BaseExtractionProvider } from './base-extraction.provider';
import {
  IExtractionProvider,
  ValidationRequest,
  ValidationResult,
  ExplanationRequest,
} from './extraction-provider.interface';

/**
 * Local Extraction Provider
 *
 * Uses pattern matching and heuristics for validation
 * No AI calls - fast and free
 */
@Injectable()
export class LocalExtractionProvider
  extends BaseExtractionProvider
  implements IExtractionProvider
{
  getName(): string {
    return 'local';
  }

  /**
   * Validate extracted content using pattern matching and heuristics
   */
  async validate(request: ValidationRequest): Promise<ValidationResult> {
    const { text, fullDocument, type } = request;

    // Get context analysis
    const context = this.analyzeContext(text, fullDocument);

    let confidence = context.contextQuality;
    const reasons: string[] = [];

    // Type-specific validation
    switch (type) {
      case 'rule':
        return this.validateRule(text, context);
      case 'entity':
        return this.validateEntity(text, context);
      case 'fact':
        return this.validateFact(text, context);
      case 'flow':
        return this.validateFlow(text, context);
      case 'requirement':
        return this.validateRequirement(text, context);
      case 'testCase':
        return this.validateTestCase(text, context);
      case 'api':
        return this.validateApi(text, context);
      default:
        return this.validateGeneric(text, context);
    }
  }

  private validateRule(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for rule keywords
    if (this.hasCondition(text) && this.hasAction(text)) {
      confidence += 30;
      reasons.push('Has condition and action structure');
    } else if (this.hasCondition(text) || this.hasAction(text)) {
      confidence += 15;
      reasons.push('Has partial rule structure');
    }

    // Check for explicit rule markers
    if (/^(rule|business rule|validation)[:\s]/i.test(text)) {
      confidence += 20;
      reasons.push('Explicitly marked as rule');
    }

    // Penalize if appears in code
    if (this.appearsInCodeComment(context)) {
      confidence -= 20;
      reasons.push('Appears in code comment');
    }

    // Too short
    if (text.length < 10) {
      confidence -= 30;
      reasons.push('Too short to be a meaningful rule');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateEntity(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for proper naming (PascalCase or camelCase)
    if (/^[A-Z][a-zA-Z0-9]*$/.test(text)) {
      confidence += 25;
      reasons.push('Proper PascalCase naming');
    }

    // Check for entity suffixes
    if (/(Model|Entity|DTO|Schema|Type|Interface|Class)$/.test(text)) {
      confidence += 20;
      reasons.push('Has entity suffix');
    }

    // Check context for entity indicators
    if (context.surroundingText?.match(/\b(class|interface|type|entity|model)\b/i)) {
      confidence += 20;
      reasons.push('Context suggests entity definition');
    }

    // Penalize stop words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are'];
    if (stopWords.includes(text.toLowerCase())) {
      confidence = 0;
      reasons.push('Common stop word');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateFact(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 60;
    const reasons: string[] = [];

    // Facts usually have numeric values
    if (/\d+/.test(text)) {
      confidence += 20;
      reasons.push('Contains numeric value');
    }

    // Check for fact keywords
    if (/\b(default|limit|max|min|threshold|timeout|rate)\b/i.test(text)) {
      confidence += 20;
      reasons.push('Contains fact keywords');
    }

    // Check for units
    if (/\b(ms|seconds?|minutes?|hours?|days?|kb|mb|gb|%|percent)\b/i.test(text)) {
      confidence += 15;
      reasons.push('Has unit of measurement');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateFlow(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for flow keywords
    if (/\b(flow|process|workflow|journey|path)\b/i.test(text)) {
      confidence += 25;
      reasons.push('Contains flow keywords');
    }

    // Check for step indicators
    if (/\b(step|stage|phase)\b/i.test(text)) {
      confidence += 15;
      reasons.push('Mentions steps/stages');
    }

    // Check for sequential indicators
    if (/\b(first|then|next|after|finally)\b/i.test(text)) {
      confidence += 15;
      reasons.push('Has sequential indicators');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateRequirement(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for requirement keywords
    if (/\b(must|shall|should|will|required|mandatory)\b/i.test(text)) {
      confidence += 25;
      reasons.push('Contains requirement keywords');
    }

    // Check for explicit requirement markers
    if (/^(req|requirement|user story|epic)[:\s#-]/i.test(text)) {
      confidence += 25;
      reasons.push('Explicitly marked as requirement');
    }

    // Check for acceptance criteria format
    if (/\b(given|when|then|as a|i want|so that)\b/i.test(text)) {
      confidence += 20;
      reasons.push('Has acceptance criteria format');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateTestCase(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for test keywords
    if (/\b(test|verify|validate|check|ensure|assert)\b/i.test(text)) {
      confidence += 20;
      reasons.push('Contains test keywords');
    }

    // Check for BDD format
    if (/\b(given|when|then|and|but)\b/i.test(text)) {
      confidence += 25;
      reasons.push('Has BDD format (Given/When/Then)');
    }

    // Check for explicit test markers
    if (/^(test|tc|scenario|case)[:\s#-]/i.test(text)) {
      confidence += 20;
      reasons.push('Explicitly marked as test');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateApi(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Check for HTTP methods
    if (/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(text)) {
      confidence += 30;
      reasons.push('Contains HTTP method');
    }

    // Check for endpoint patterns
    if (/\/[a-z0-9\-_\/{}:]+/i.test(text)) {
      confidence += 25;
      reasons.push('Has endpoint path pattern');
    }

    // Check for API keywords
    if (/\b(endpoint|api|route|path|resource)\b/i.test(text)) {
      confidence += 20;
      reasons.push('Contains API keywords');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  private validateGeneric(text: string, context: any): ValidationResult {
    let confidence = context.contextQuality || 50;
    const reasons: string[] = [];

    // Basic length check
    if (text.length < 3) {
      confidence -= 40;
      reasons.push('Too short');
    } else if (text.length > 5 && text.length < 200) {
      confidence += 10;
      reasons.push('Reasonable length');
    }

    // Capitalization
    if (/^[A-Z]/.test(text)) {
      confidence += 10;
      reasons.push('Properly capitalized');
    }

    return {
      confidence: Math.max(0, Math.min(100, confidence)),
      reason: reasons.join('; '),
      contextQuality: context.contextQuality,
    };
  }

  /**
   * Generate simple explanation (no AI)
   */
  async generateExplanation(request: ExplanationRequest): Promise<string> {
    const { type, name } = request;
    return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${name}`;
  }
}
