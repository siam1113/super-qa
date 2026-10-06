import { isDeepStrictEqual } from 'util';
import { sectionsCorpus } from '../fixtures/extraction-sections-corpus';
import { assertExtractionEvidence, extractGrounded } from '../../src/modules/business/grounded-extraction';
import { LocalExtractionProvider } from '../../src/modules/business/extraction-providers/local-extraction.provider';

describe('field-exact section corpus', () => {
  it('measures complete structured claims, not just matching type labels', async () => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let correctAbstentions = 0;
    for (const fixture of sectionsCorpus) {
      const document = { id: fixture.id, sourceId: 'sections-evaluation', content: fixture.text };
      const result = await extractGrounded(document, new LocalExtractionProvider());
      const actual = result.items.map(item => ({ type: item.type, name: item.name, content: item.content ?? null }));
      const gold = fixture.gold.map(({ supported, ...claim }) => claim);
      const expected = fixture.gold.filter(claim => claim.supported).map(({ supported, ...claim }) => claim);
      expect({ id: fixture.id, claims: actual }).toEqual({ id: fixture.id, claims: expected });
      const matched = actual.filter(claim => gold.some(expectedClaim => isDeepStrictEqual(claim, expectedClaim))).length;
      truePositives += matched;
      falsePositives += actual.length - matched;
      falseNegatives += gold.length - matched;
      if (!gold.length && !actual.length) correctAbstentions++;
      assertExtractionEvidence(result, document);
      for (const item of result.items) for (const evidence of item.metadata!.evidence) {
        for (const field of evidence.fields) expect(document.content.slice(field.start, field.end)).toBe(field.quote);
      }
      expect(result.report.providerCalls).toBe(0);
    }
    expect({ truePositives, falsePositives, falseNegatives, correctAbstentions }).toEqual({
      truePositives: 11, falsePositives: 0, falseNegatives: 2, correctAbstentions: 3,
    });
  });
});
