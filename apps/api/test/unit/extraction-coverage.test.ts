import { extractGrounded, assertExtractionEvidence } from '../../src/modules/business/grounded-extraction';
import { LocalExtractionProvider } from '../../src/modules/business/extraction-providers/local-extraction.provider';

const provider = new LocalExtractionProvider();
const document = (content: string) => ({ id: 'coverage', sourceId: 'source', content });

describe('section-aware extraction coverage', () => {
  it('extracts unlabeled obligations without duplicating explicit rules', async () => {
    const source = document('Users must not share passwords.\n- The system shall lock accounts after five failures.\nRule: Guests must log in.');
    const result = await extractGrounded(source, provider);
    expect(result.items.map(item => item.type)).toEqual(['requirement', 'requirement', 'rule']);
    expect(result.items[0].description).toBe('Users must not share passwords.');
    assertExtractionEvidence(result, source);
  });

  it('extracts bounded numbered workflows with exact per-step evidence', async () => {
    const source = document('😀 Introduction\r\n## Checkout flow:\r\n1. Select an item\r\n2. Pay\r\n3. Receive confirmation\r\n\r\n## Notes\r\n1. Unrelated step');
    const result = await extractGrounded(source, provider);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: 'flow', name: 'Checkout', content: { steps: [
      { order: 1, name: 'Select an item' }, { order: 2, name: 'Pay' }, { order: 3, name: 'Receive confirmation' },
    ] } });
    const evidence = result.items[0].metadata!.evidence[0];
    expect(evidence.fields.find((field: any) => field.path === '/content/steps/1/name').quote).toBe('Pay');
    for (const field of evidence.fields) expect(source.content.slice(field.start, field.end)).toBe(field.quote);
    assertExtractionEvidence(result, source);
  });

  it('extracts BDD preconditions, actions and expectations without inventing outcomes', async () => {
    const source = document('Scenario: Declined payment\nGiven a valid cart\nAnd a signed-in customer\nWhen payment is declined\nThen no order is created\nAnd the cart is retained');
    const result = await extractGrounded(source, provider);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: 'test_case', name: 'Declined payment', content: {
      preconditions: ['a valid cart', 'a signed-in customer'],
      steps: [{ order: 1, action: 'payment is declined', expected: 'no order is created\nthe cart is retained' }],
    } });
    expect(result.items[0].metadata!.evidence[0].fields.filter((field: any) => field.path === '/content/steps/0/expected')).toHaveLength(2);
    assertExtractionEvidence(result, source);
  });

  it.each([
    'Scenario: Missing oracle\nGiven a cart\nWhen users must pay',
    'Scenario: Wrong order\nThen an order exists\nWhen a customer pays',
    'Scenario Outline: Cart\nGiven <cart>\nWhen paid\nThen accepted',
    'Flow: Broken numbering\n1. Start\n3. Finish',
    'Flow: Empty\nNo steps here',
    '# Examples\nFlow: Fake\n1. Start\n2. Finish\n## Nested\nUsers must pay twice.',
    '```markdown\nScenario: Fake\nGiven a cart\nWhen paid\nThen accepted\n```',
    'If users must authenticate, should guests be exempt?',
    'Users must log in?',
    'Rule: Must users log in?',
    'Someone said users must pay twice.',
    'Maybe users must authenticate.',
  ])('abstains on incomplete, excluded or ambiguous input: %s', async content => {
    expect((await extractGrounded(document(content), provider)).items).toEqual([]);
  });

  it('rejects altered fields and nested content after JSONB-style key reordering', async () => {
    const source = document('Flow: Checkout\n1. Select an item\n2. Pay');
    const result = await extractGrounded(source, provider);
    const item = result.items[0];
    expect(item).toBeDefined();
    const steps = (item.content as any).steps;
    steps[0] = { name: steps[0].name, order: steps[0].order };
    assertExtractionEvidence(result, source);
    item.metadata!.evidence[0].fields[0].start++;
    expect(() => assertExtractionEvidence(result, source)).toThrow('evidence');
  });

  it('sends the complete bounded scenario with the correct provider type', async () => {
    const remote = { getName: () => 'openai', validate: jest.fn().mockResolvedValue({ confidence: 90, reason: 'supported' }) };
    const text = 'Scenario: Payment\nGiven a cart\nWhen paid\nThen accepted';
    await extractGrounded(document(text), remote as any);
    expect(remote.validate).toHaveBeenCalledWith({ text, fullDocument: text, type: 'testCase' });
  });

  it('rejects conflicting names before validation instead of overwriting one claim', async () => {
    const remote = { getName: () => 'openai', validate: jest.fn() };
    await expect(extractGrounded(document('Flow: Checkout\n1. Select\n2. Pay\n\nFlow: Checkout\n1. Select\n2. Cancel'), remote as any)).rejects.toThrow('Ambiguous extraction identity');
    expect(remote.validate).not.toHaveBeenCalled();
  });

  it('keeps nested excluded sections excluded until their parent ends', async () => {
    const source = document('# Examples\n## Draft\nUsers must pay twice.\n## Rules\nUsers must pay twice.\n# Requirements\nUsers must log in.');
    const result = await extractGrounded(source, provider);
    expect(result.items.map(item => item.name)).toEqual(['Users must log in.']);
  });

  it('fails oversized blocks rather than accepting a truncated workflow', async () => {
    const source = document('Flow: Oversized\n' + Array.from({ length: 51 }, (_, index) => `${index + 1}. Step ${index + 1}`).join('\n'));
    await expect(extractGrounded(source, provider)).rejects.toThrow('block budget');
  });
});
