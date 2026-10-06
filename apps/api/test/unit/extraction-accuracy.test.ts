import { extractionCorpus } from '../fixtures/extraction-corpus';
import { extractGrounded, assertExtractionEvidence } from '../../src/modules/business/grounded-extraction';
import { LocalExtractionProvider } from '../../src/modules/business/extraction-providers/local-extraction.provider';

describe('versioned extraction accuracy corpus', () => {
  it('measures supported precision, total recall, abstention and evidence integrity separately', async () => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let supportedPositives = 0;
    let supportedMatches = 0;
    let correctAbstentions = 0;
    let providerCalls = 0;
    for (const fixture of extractionCorpus) {
      const document = { id: fixture.id, sourceId: 'evaluation', content: fixture.text };
      const result = await extractGrounded(document, new LocalExtractionProvider());
      assertExtractionEvidence(result, document);
      const matches = result.items.filter(item => item.type === fixture.type).length;
      truePositives += Math.min(matches, 1);
      falsePositives += result.items.length - Math.min(matches, 1);
      if (fixture.type && !matches) falseNegatives++;
      if (fixture.supported) { supportedPositives++; supportedMatches += Math.min(matches, 1); }
      if (!fixture.type && !result.items.length) correctAbstentions++;
      providerCalls += result.report.providerCalls;
    }
    expect({ truePositives, falsePositives, falseNegatives, correctAbstentions, providerCalls }).toEqual({
      truePositives: 11, falsePositives: 0, falseNegatives: 1, correctAbstentions: 8, providerCalls: 0,
    });
    expect(truePositives / (truePositives + falsePositives)).toBe(1);
    expect(supportedMatches / supportedPositives).toBe(1);
    expect(truePositives / (truePositives + falseNegatives)).toBeCloseTo(11 / 12);
  });
});
