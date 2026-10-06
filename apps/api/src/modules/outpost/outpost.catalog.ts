import { OutpostAutonomyLevel, OutpostTrigger } from './outpost.entity';

export interface BuiltinActivityDef {
  key: string;
  name: string;
  description: string;
  skill: string;
  triggers: OutpostTrigger[];
  autonomyLevel: OutpostAutonomyLevel;
}

// The v1 catalog: every entry calls a skill that already exists in the Python
// runtime's registry (agents/shared/skills/registry.py) — no new skill logic,
// just scheduling/event wiring and autonomy enforcement around what already ships.
export const BUILTIN_ACTIVITIES: Record<'qae' | 'aue', BuiltinActivityDef[]> = {
  qae: [
    {
      key: 'qae.coverage_gap_scan', name: 'Coverage Gap Scan',
      description: 'Flags new or changed acceptance criteria with no matching test case.',
      skill: 'review_requirements', triggers: [{ type: 'event', event: 'source.synced' }], autonomyLevel: 'observer',
    },
    {
      key: 'qae.failure_pattern_digest', name: 'Failure Pattern Digest',
      description: 'Clusters recent failed executions by likely shared root cause.',
      skill: 'analyze_failures', triggers: [{ type: 'schedule', cron: '0 7 * * *' }], autonomyLevel: 'observer',
    },
    {
      key: 'qae.release_readiness_summary', name: 'Release Readiness Summary',
      description: 'Rolls up coverage, open gaps and recent failures into a go/no-go digest.',
      skill: 'assess_release_readiness', triggers: [{ type: 'schedule', cron: '0 7 * * 1' }], autonomyLevel: 'observer',
    },
    {
      key: 'qae.coverage_audit', name: 'Coverage Audit',
      description: 'Calculates criterion coverage and traceability, drafting a gap list.',
      skill: 'analyze_coverage', triggers: [{ type: 'schedule', cron: '0 8 * * 1' }], autonomyLevel: 'suggest',
    },
  ],
  aue: [
    {
      key: 'aue.regression_readiness_check', name: 'Regression Readiness Check',
      description: 'Recommends which suites to run from the exact changes since the last run.',
      skill: 'select_regression_tests', triggers: [{ type: 'event', event: 'source.synced' }], autonomyLevel: 'observer',
    },
    {
      key: 'aue.nightly_regression_run', name: 'Nightly Regression Run',
      description: 'Submits the approved suite for a fresh run; posts the plan until escalated to Act.',
      skill: 'run_automation_suite', triggers: [{ type: 'schedule', cron: '0 2 * * *' }], autonomyLevel: 'suggest',
    },
    {
      key: 'aue.flake_locator_digest', name: 'Flake & Locator Digest',
      description: 'Groups mixed-outcome failures that point at flake or selector drift.',
      skill: 'analyze_failures', triggers: [{ type: 'event', event: 'outpost.run.completed' }], autonomyLevel: 'observer',
    },
    {
      key: 'aue.self_healing_suggestion', name: 'Self-Healing Suggestion',
      description: 'Validates a proposed selector/fixture repair for one failing test.',
      skill: 'maintain_automation', triggers: [{ type: 'event', event: 'outpost.activity.finding' }], autonomyLevel: 'suggest',
    },
    {
      key: 'aue.framework_environment_health_check', name: 'Framework & Environment Health Check',
      description: 'Checks environment prerequisites and inspects the repository for framework drift.',
      skill: 'check_test_readiness', triggers: [{ type: 'schedule', cron: '0 8 * * 1' }], autonomyLevel: 'observer',
    },
    {
      key: 'aue.coverage_to_automation_handoff', name: 'Coverage-to-Automation Handoff',
      description: "Drafts an automation script backlog item when qae's Coverage Gap Scan flags a gap.",
      skill: 'generate_automation', triggers: [{ type: 'event', event: 'outpost.activity.finding' }], autonomyLevel: 'suggest',
    },
  ],
};
