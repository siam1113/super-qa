export class MockEmbeddingService {
  private embeddingDimension = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    // Generate mock embeddings (random vectors)
    return texts.map(() => this.generateMockEmbedding());
  }

  private generateMockEmbedding(): number[] {
    return Array.from({ length: this.embeddingDimension }, () => Math.random());
  }

  async embedSingle(text: string): Promise<number[]> {
    return this.generateMockEmbedding();
  }
}
