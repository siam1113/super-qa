import { Injectable } from '@nestjs/common';
import {
  mockTestCases,
  mockExecutions,
  mockHealingSuggestions,
  mockFlows,
  mockFacts,
  mockDashboardStats,
} from './mock-data';
import { SourcesService } from '../sources/sources.service';
import { BusinessService } from '../business/business.service';

@Injectable()
export class QaService {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly businessService: BusinessService,
  ) {}
  getDashboard() {
    return {
      stats: mockDashboardStats,
      recentExecutions: mockExecutions.slice(0, 5),
      topRisks: mockTestCases
        .filter((tc) => tc.risk === 'critical' || tc.risk === 'high')
        .slice(0, 5),
      pendingHealing: mockHealingSuggestions.filter((h) => h.status === 'pending').length,
    };
  }

  getTestCases(filters?: { priority?: string; automation?: string; risk?: string }) {
    let results = [...mockTestCases];

    if (filters?.priority) {
      results = results.filter((tc) => tc.priority === filters.priority);
    }
    if (filters?.automation) {
      results = results.filter((tc) => tc.automation === filters.automation);
    }
    if (filters?.risk) {
      results = results.filter((tc) => tc.risk === filters.risk);
    }

    return results;
  }

  getTestCase(id: string) {
    return mockTestCases.find((tc) => tc.id === id) || null;
  }

  getExecutions(filters?: { status?: string; environment?: string; browser?: string }) {
    let results = [...mockExecutions];

    if (filters?.status) {
      results = results.filter((e) => e.status === filters.status);
    }
    if (filters?.environment) {
      results = results.filter((e) => e.environment === filters.environment);
    }
    if (filters?.browser) {
      results = results.filter((e) => e.browser === filters.browser);
    }

    return results;
  }

  getHealingSuggestions(status?: string) {
    if (status) {
      return mockHealingSuggestions.filter((h) => h.status === status);
    }
    return mockHealingSuggestions;
  }

  approveHealing(id: string) {
    // In real implementation, this would update the database
    return { success: true, message: 'Healing suggestion approved' };
  }

  rejectHealing(id: string) {
    return { success: true, message: 'Healing suggestion rejected' };
  }

  getFlows() {
    return mockFlows;
  }

  getFlow(name: string) {
    return mockFlows.find((f) => f.name.toLowerCase() === name.toLowerCase()) || null;
  }

  getFacts(category?: string) {
    if (category) {
      return mockFacts.filter((f) => f.category === category);
    }
    return mockFacts;
  }

  runTests(testIds?: string[]) {
    return {
      executionId: `EX-${Date.now()}`,
      status: 'queued',
      testsQueued: testIds?.length || mockTestCases.length,
      estimatedDuration: '15 minutes',
    };
  }

  getWorkspace() {
    return {
      name: 'Acme Corp QA',
      stats: mockDashboardStats,
      testCases: mockTestCases,
      executions: mockExecutions,
      healingSuggestions: mockHealingSuggestions,
      flows: mockFlows,
      facts: mockFacts,
    };
  }

  async getContextCounts() {
    // Fetch real counts from database
    const [sources, businessStats] = await Promise.all([
      this.sourcesService.findAll(),
      this.businessService.getStatsByType(),
    ]);

    // Cast to Record<string, number> for flexible key access
    const stats = businessStats as Record<string, number>;

    return {
      // Sources count from database
      sources: sources.length,
      // Product - from business items by type
      flows: stats['flow'] || 0,
      facts: stats['fact'] || 0,
      entities: stats['entity'] || 0,
      rules: stats['rule'] || 0,
      states: stats['state'] || 0,
      permissions: stats['permission'] || 0,
      integrations: stats['integration'] || 0,
      constraints: stats['constraint'] || 0,
      configurations: stats['configuration'] || 0,
      terminology: stats['terminology'] || 0,
      features: 0, // Not in BusinessItemType yet
      personas: 0, // Not in BusinessItemType yet
      // Technical
      apis: stats['api'] || 0,
      code: stats['code'] || 0,
      architecture: stats['architecture'] || 0,
      database: stats['database'] || 0,
      // Quality
      testCases: stats['test_case'] || 0,
      requirements: stats['requirement'] || 0,
      defects: stats['defect'] || 0,
      // Automation
      dom: stats['dom'] || 0,
      locators: stats['locator'] || 0,
      actions: stats['action'] || 0,
      dataSetup: stats['data_setup'] || 0,
      auth: stats['auth'] || 0,
    };
  }
}
