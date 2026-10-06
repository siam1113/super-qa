interface GoldClaim {
  type: string;
  name: string;
  content: unknown;
  supported: boolean;
}

export const sectionsCorpus: Array<{ id: string; text: string; gold: GoldClaim[] }> = [
  {
    id: 'mixed-checkout',
    text: '# Checkout\nUsers must authenticate before checkout.\n\nFlow: Purchase\n1. Select an item\n2. Pay\n\nScenario: Declined\nGiven a cart\nWhen payment fails\nThen no order is created',
    gold: [
      { type: 'requirement', name: 'Users must authenticate before checkout.', content: null, supported: true },
      { type: 'flow', name: 'Purchase', content: { steps: [{ order: 1, name: 'Select an item' }, { order: 2, name: 'Pay' }] }, supported: true },
      { type: 'test_case', name: 'Declined', content: { preconditions: ['a cart'], steps: [{ order: 1, action: 'payment fails', expected: 'no order is created' }] }, supported: true },
    ],
  },
  {
    id: 'heading-workflow', text: '## Refund workflow:\n1) Open request\n2) Approve refund\n\n## Notes\n1. Unrelated list',
    gold: [{ type: 'flow', name: 'Refund', content: { steps: [{ order: 1, name: 'Open request' }, { order: 2, name: 'Approve refund' }] }, supported: true }],
  },
  {
    id: 'unicode-crlf', text: '😀 Payment\r\nScenario: Reject\r\nGiven a cart\r\nWhen rejected\r\nThen cart remains',
    gold: [{ type: 'test_case', name: 'Reject', content: { preconditions: ['a cart'], steps: [{ order: 1, action: 'rejected', expected: 'cart remains' }] }, supported: true }],
  },
  {
    id: 'and-clauses', text: 'Scenario: Retry\nGiven a cart\nAnd an expired token\nWhen the user signs in\nAnd retries payment\nThen one order exists\nBut no duplicate charge exists',
    gold: [{ type: 'test_case', name: 'Retry', content: { preconditions: ['a cart', 'an expired token'], steps: [{ order: 1, action: 'the user signs in\nretries payment', expected: 'one order exists\nno duplicate charge exists' }] }, supported: true }],
  },
  {
    id: 'adjacent-scenarios', text: 'Scenario: Accepted\nGiven a cart\nWhen approved\nThen an order exists\nScenario: Rejected\nGiven a cart\nWhen declined\nThen no order exists',
    gold: [
      { type: 'test_case', name: 'Accepted', content: { preconditions: ['a cart'], steps: [{ order: 1, action: 'approved', expected: 'an order exists' }] }, supported: true },
      { type: 'test_case', name: 'Rejected', content: { preconditions: ['a cart'], steps: [{ order: 1, action: 'declined', expected: 'no order exists' }] }, supported: true },
    ],
  },
  {
    id: 'excluded-parent-restoration', text: '# Examples\n## Draft\nUsers must pay twice.\n## Notes\nUsers must pay twice.\n# Requirements\nGuests must not delete accounts.',
    gold: [{ type: 'requirement', name: 'Guests must not delete accounts.', content: null, supported: true }],
  },
  {
    id: 'contradictory-obligations', text: 'Users must approve refunds.\nUsers must not approve refunds.',
    gold: [
      { type: 'requirement', name: 'Users must approve refunds.', content: null, supported: true },
      { type: 'requirement', name: 'Users must not approve refunds.', content: null, supported: true },
    ],
  },
  {
    id: 'unsupported-actor', text: 'The gateway must reject invalid signatures.',
    gold: [{ type: 'requirement', name: 'The gateway must reject invalid signatures.', content: null, supported: false }],
  },
  {
    id: 'unsupported-entity', text: 'interface Account {\n  email: string;\n}',
    gold: [{ type: 'entity', name: 'Account', content: { attributes: [{ name: 'email', type: 'string' }] }, supported: false }],
  },
  { id: 'missing-outcome', text: 'Scenario: Payment\nGiven a cart\nWhen the customer pays', gold: [] },
  { id: 'example-flow', text: '# Examples\nFlow: Fake\n1. Start\n2. Finish', gold: [] },
  { id: 'reported-question', text: 'Someone said users must pay twice.\nIf users must sign in, should guests be exempt?', gold: [] },
];
