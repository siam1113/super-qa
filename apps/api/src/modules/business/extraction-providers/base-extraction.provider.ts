import { ContextAnalysis } from './extraction-provider.interface';

/**
 * Base Extraction Provider
 *
 * Provides common functionality for all extraction providers
 */
export abstract class BaseExtractionProvider {
  /**
   * Analyze context around extracted text
   */
  analyzeContext(text: string, fullDocument: string): ContextAnalysis {
    const startIndex = fullDocument.indexOf(text);

    if (startIndex === -1) {
      return {
        surroundingText: text,
        contextQuality: 0,
      };
    }

    // Extract 500 chars before and after
    const before = fullDocument.slice(Math.max(0, startIndex - 500), startIndex);
    const after = fullDocument.slice(
      startIndex + text.length,
      startIndex + text.length + 500,
    );

    const surroundingText = before + text + after;

    // Calculate context quality
    const contextQuality = this.scoreContext(before, after);

    // Extract heading from before text
    const headingContext = this.extractHeading(before);

    // Infer section type
    const sectionType = this.inferSectionType(before, after);

    return {
      surroundingText,
      contextQuality,
      headingContext,
      sectionType,
    };
  }

  /**
   * Score context quality (0-100)
   */
  protected scoreContext(before: string, after: string): number {
    let score = 50; // Base score

    // Check for headings in before text
    if (/^#{1,6}\s+.+$/m.test(before)) score += 15;
    if (/<h[1-6]>/i.test(before)) score += 15;

    // Check for structure
    if (/^[-*]\s+/m.test(before) || /^[-*]\s+/m.test(after)) score += 10;
    if (/^\d+\.\s+/m.test(before) || /^\d+\.\s+/m.test(after)) score += 10;

    // Penalize code blocks
    if (/```/.test(before) || /```/.test(after)) score -= 20;

    // Reward proper paragraphs
    if (before.trim().length > 100) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Extract heading from before text
   */
  protected extractHeading(before: string): string | undefined {
    // Markdown headings
    const markdownMatch = before.match(/^#{1,6}\s+(.+)$/m);
    if (markdownMatch) return markdownMatch[1].trim();

    // HTML headings
    const htmlMatch = before.match(/<h[1-6]>(.+?)<\/h[1-6]>/i);
    if (htmlMatch) return htmlMatch[1].trim();

    return undefined;
  }

  /**
   * Infer section type from context
   */
  protected inferSectionType(before: string, after: string): string | undefined {
    const context = (before + after).toLowerCase();

    if (context.includes('requirement') || context.includes('spec')) {
      return 'requirements';
    }
    if (context.includes('test') || context.includes('scenario')) {
      return 'testing';
    }
    if (context.includes('api') || context.includes('endpoint')) {
      return 'api';
    }
    if (context.includes('flow') || context.includes('process')) {
      return 'flow';
    }

    return undefined;
  }

  /**
   * Convert 0-100 score to confidence level
   */
  scoreToLevel(score: number): 'high' | 'medium' | 'low' | 'inferred' {
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'low';
    return 'inferred';
  }

  /**
   * Check if text appears in code comment
   */
  protected appearsInCodeComment(context: ContextAnalysis): boolean {
    const text = context.surroundingText.toLowerCase();
    return (
      text.includes('//') ||
      text.includes('/*') ||
      text.includes('*/') ||
      text.includes('#') && text.includes('def ') ||
      text.includes('"""') ||
      text.includes("'''")
    );
  }

  /**
   * Check if text is in table or list
   */
  protected isInTableOrList(context: ContextAnalysis): boolean {
    const text = context.surroundingText;
    return (
      text.includes('|') && text.includes('|') || // Table
      /^[-*+]\s+/m.test(text) // List
    );
  }

  /**
   * Check if rule has condition
   */
  protected hasCondition(text: string): boolean {
    return /\b(if|when|where|given|provided|in case)\b/i.test(text);
  }

  /**
   * Check if rule has action
   */
  protected hasAction(text: string): boolean {
    return /\b(then|must|shall|should|will|need|require)\b/i.test(text);
  }
}
