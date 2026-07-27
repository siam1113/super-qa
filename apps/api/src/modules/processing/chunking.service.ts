import { Injectable } from '@nestjs/common';

export interface TextChunk {
  content: string;
  index: number;
  startChar: number;
  endChar: number;
}

@Injectable()
export class ChunkingService {
  private readonly defaultChunkSize = 500; // tokens (approximate via characters)
  private readonly defaultOverlap = 50;

  /**
   * Split text into overlapping chunks
   * Uses simple character-based splitting with sentence awareness
   */
  chunk(
    text: string,
    chunkSize: number = this.defaultChunkSize,
    overlap: number = this.defaultOverlap,
  ): TextChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Approximate characters per token (rough estimate)
    const charsPerToken = 4;
    const maxChars = chunkSize * charsPerToken;
    const overlapChars = overlap * charsPerToken;

    const chunks: TextChunk[] = [];
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < text.length) {
      let endIndex = Math.min(startIndex + maxChars, text.length);

      // Try to end at a sentence boundary
      if (endIndex < text.length) {
        const sentenceEnd = this.findSentenceEnd(text, startIndex, endIndex);
        if (sentenceEnd > startIndex + maxChars / 2) {
          endIndex = sentenceEnd;
        }
      }

      const chunkText = text.slice(startIndex, endIndex).trim();

      if (chunkText.length > 0) {
        chunks.push({
          content: chunkText,
          index: chunkIndex,
          startChar: startIndex,
          endChar: endIndex,
        });
        chunkIndex++;
      }

      // Move to next chunk with overlap
      startIndex = endIndex - overlapChars;
      if (startIndex >= text.length || startIndex <= chunks[chunks.length - 1]?.startChar) {
        break;
      }
    }

    return chunks;
  }

  /**
   * Find the best sentence ending within the range
   */
  private findSentenceEnd(text: string, start: number, end: number): number {
    const searchText = text.slice(start, end);

    // Look for sentence endings
    const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    let lastEnd = -1;

    for (const ender of sentenceEnders) {
      const idx = searchText.lastIndexOf(ender);
      if (idx > lastEnd) {
        lastEnd = idx;
      }
    }

    if (lastEnd > 0) {
      // Include the punctuation
      return start + lastEnd + 1;
    }

    // Fall back to paragraph break
    const paraBreak = searchText.lastIndexOf('\n\n');
    if (paraBreak > 0) {
      return start + paraBreak;
    }

    // Fall back to line break
    const lineBreak = searchText.lastIndexOf('\n');
    if (lineBreak > 0) {
      return start + lineBreak;
    }

    return end;
  }

  /**
   * Split code into chunks by function/class boundaries
   */
  chunkCode(code: string, language?: string): TextChunk[] {
    // For now, use simple chunking
    // TODO: Add language-aware code chunking
    return this.chunk(code, 800, 100);
  }
}
