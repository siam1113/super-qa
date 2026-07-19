export class RunRequestDto { environment = 'staging'; browser = 'chromium'; tags: string[] = []; engine = 'playwright'; retry = 1; }
export class HealingDecisionDto { suggestionId!: string; decision!: 'approve' | 'reject'; scope: 'test' | 'action-library' = 'action-library'; }
export class GenerateTestsDto { flow!: string; risk = 'High'; count = 8; }
