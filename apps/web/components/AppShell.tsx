'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { SuperQA } from './SuperQA';
import { Dashboard } from './pages/Dashboard';
import { TestCases } from './pages/TestCases';
import { PlaceholderPage } from './pages/PlaceholderPages';
import { SourcesPage } from './pages/Sources';
import { SyncJobsPage } from './pages/SyncJobs';
import {
  BusinessPage,
  BusinessFlowsPage,
  BusinessFactsPage,
  BusinessEntitiesPage,
  BusinessRulesPage,
  BusinessStatesPage,
  BusinessPermissionsPage,
  BusinessIntegrationsPage,
  BusinessConstraintsPage,
  BusinessConfigurationsPage,
  BusinessTerminologyPage,
  TechnicalApisPage,
  TechnicalCodePage,
  TechnicalArchitecturePage,
  TechnicalDatabasePage,
  QualityTestCasesPage,
  QualityRequirementsPage,
  QualityDefectsPage,
  AutomationDomPage,
  AutomationLocatorsPage,
  AutomationActionsPage,
  AutomationDataSetupPage,
  AutomationAuthPage,
  ProductFeaturesPage,
  ProductPersonasPage,
} from './pages/Business';
import { EnvironmentsPage } from './pages/Environments';
import { QAEngineerPage, AutomationEngineerPage } from './pages/Agents';
import { CommandCenterPage } from './pages/CommandCenter';

export function AppShell() {
  const { currentPage, loading, setLoading, setData, setContextCounts, theme, setCurrentPage } = useAppStore();

  // Fetch data on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [workspaceRes, countsRes] = await Promise.all([
          fetch('http://localhost:4000/api/qa/workspace'),
          fetch('http://localhost:4000/api/qa/context-counts'),
        ]);

        if (workspaceRes.ok) {
          const data = await workspaceRes.json();
          setData({
            stats: data.stats,
            testCases: data.testCases,
            executions: data.executions,
            healingSuggestions: data.healingSuggestions,
            flows: data.flows,
            facts: data.facts,
          });
        }

        if (countsRes.ok) {
          const counts = await countsRes.json();
          setContextCounts(counts);
        }
      } catch (error) {
        console.log('API not available, using fallback data');
        // Fallback mock data
        setData({
          stats: {
            passed: 1284,
            passedChange: 8.2,
            failed: 37,
            failedChange: -12.4,
            blocked: 9,
            blockedChange: 2,
            running: 14,
            skipped: 23,
            duration: '2h 34m',
            aiConfidence: 91,
            aiConfidenceChange: 3,
            healingCount: 22,
            healingPending: 5,
          },
          testCases: [
            { id: 'TC-1001', title: 'Login with valid enterprise SSO user', priority: 'P0', automation: 'automated', owner: 'Maya Chen', flow: 'Authentication / Login', tags: ['sso', 'auth'], lastRun: new Date().toISOString(), passRate: 98, coverage: 85, risk: 'high', aiScore: 94 },
            { id: 'TC-1002', title: 'Login with invalid credentials shows error', priority: 'P0', automation: 'automated', owner: 'Maya Chen', flow: 'Authentication / Login', tags: ['auth', 'negative'], lastRun: new Date().toISOString(), passRate: 100, coverage: 90, risk: 'high', aiScore: 96 },
            { id: 'TC-1042', title: 'Payment decline shows error banner', priority: 'P0', automation: 'automated', owner: 'Ravi Patel', flow: 'Checkout / Payment', tags: ['payment', 'error-handling'], lastRun: new Date().toISOString(), passRate: 87, coverage: 78, risk: 'critical', aiScore: 89 },
            { id: 'TC-1043', title: 'Successful payment redirects to confirmation', priority: 'P0', automation: 'automated', owner: 'Ravi Patel', flow: 'Checkout / Payment', tags: ['payment', 'happy-path'], lastRun: new Date().toISOString(), passRate: 95, coverage: 82, risk: 'critical', aiScore: 92 },
            { id: 'TC-1128', title: 'Archived user cannot checkout', priority: 'P1', automation: 'partial', owner: 'Elena Garcia', flow: 'Checkout / Confirmation', tags: ['checkout', 'permissions'], lastRun: new Date().toISOString(), passRate: 75, coverage: 45, risk: 'medium', aiScore: 77 },
          ],
          executions: [
            { testName: 'TC-1042 Payment decline shows error banner', testId: 'TC-1042', flow: 'Checkout / Payment', browser: 'Chrome', environment: 'Staging', status: 'failed', duration: 48, retry: 1, aiConfidence: 87, owner: 'Ravi Patel', startedAt: new Date().toISOString(), errorMessage: 'Element not found: button[data-testid="pay-now"]' },
            { testName: 'TC-1001 Login with valid enterprise SSO user', testId: 'TC-1001', flow: 'Authentication / Login', browser: 'Chrome', environment: 'Staging', status: 'passed', duration: 12, retry: 0, aiConfidence: 98, owner: 'Maya Chen', startedAt: new Date().toISOString() },
            { testName: 'TC-1201 Add item to cart from product page', testId: 'TC-1201', flow: 'Checkout / Add Item', browser: 'Firefox', environment: 'Production', status: 'passed', duration: 8, retry: 0, aiConfidence: 99, owner: 'Elena Garcia', startedAt: new Date().toISOString() },
            { testName: 'TC-1128 Archived user cannot checkout', testId: 'TC-1128', flow: 'Checkout / Confirmation', browser: 'Chrome', environment: 'Staging', status: 'blocked', duration: 0, retry: 0, aiConfidence: 65, owner: 'Elena Garcia', startedAt: new Date().toISOString(), errorMessage: 'Test data setup failed' },
            { testName: 'TC-1043 Successful payment redirects to confirmation', testId: 'TC-1043', flow: 'Checkout / Payment', browser: 'Chrome', environment: 'Staging', status: 'running', duration: 0, retry: 0, aiConfidence: 91, owner: 'Ravi Patel', startedAt: new Date().toISOString() },
          ],
          healingSuggestions: [
            { issue: 'button[data-testid="pay-now"] no longer found', affectedTests: ['TC-1042', 'TC-1043', 'TC-1044'], currentLocator: 'button[data-testid="pay-now"]', suggestedLocator: "getByRole('button', { name: 'Pay now' })", confidence: 94, risk: 'low', owner: 'Healer Agent', status: 'pending', rootCause: 'Button testid was removed in recent commit. Role-based locator is more stable.' },
            { issue: '#login-email selector ambiguous', affectedTests: ['TC-1001', 'TC-1002', 'TC-1003'], currentLocator: '#login-email', suggestedLocator: "getByLabel('Email address')", confidence: 89, risk: 'low', owner: 'Healer Agent', status: 'pending', rootCause: 'Multiple elements match #login-email. Label-based selector is unique.' },
            { issue: 'Cart total XPath fragile', affectedTests: ['TC-1201', 'TC-1202'], currentLocator: '/html/body/div[2]/main/div[3]/span[2]', suggestedLocator: "[data-testid='cart-total']", confidence: 78, risk: 'medium', owner: 'Healer Agent', status: 'pending', rootCause: 'Absolute XPath breaks on DOM changes. Test ID recommended.' },
          ],
          flows: [
            { name: 'Login', module: 'Authentication', description: 'User authentication via email/password or SSO', risk: 'high', priority: 'P0', coverage: 88, automation: 95, relatedPages: ['Login Page', 'SSO Redirect'], dependencies: [] },
            { name: 'Registration', module: 'Authentication', description: 'New user account creation flow', risk: 'high', priority: 'P0', coverage: 75, automation: 80, relatedPages: ['Registration Page', 'Email Verification'], dependencies: [] },
            { name: 'Payment', module: 'Checkout', description: 'Process payment with various methods', risk: 'critical', priority: 'P0', coverage: 78, automation: 85, relatedPages: ['Payment Page', 'Card Entry'], dependencies: ['Login'] },
            { name: 'Add Item', module: 'Checkout', description: 'Add products to shopping cart', risk: 'high', priority: 'P0', coverage: 92, automation: 98, relatedPages: ['Product Page', 'Cart Page'], dependencies: ['Login'] },
          ],
          facts: [
            { text: 'A locked account cannot start checkout', category: 'business_rule', confidence: 96, source: 'Confluence: Checkout Requirements', createdBy: 'Context Manager Agent', aiGenerated: true, humanVerified: true, relatedObjects: ['TC-1128'] },
            { text: 'SSO login bypasses MFA for enterprise users', category: 'business_rule', confidence: 92, source: 'Jira: AUTH-445', createdBy: 'Context Manager Agent', aiGenerated: true, humanVerified: true, relatedObjects: ['TC-1001'] },
            { text: 'Payment timeout is 30 seconds before retry prompt', category: 'constraint', confidence: 88, source: 'API Documentation', createdBy: 'Ravi Patel', aiGenerated: false, humanVerified: true, relatedObjects: ['TC-1042', 'TC-1043'] },
          ],
        });
        // Fallback context counts - use 0 for all if no real data
        setContextCounts({
          sources: 0,
          flows: 0,
          facts: 0,
          entities: 0,
          rules: 0,
          states: 0,
          permissions: 0,
          integrations: 0,
          constraints: 0,
          configurations: 0,
          terminology: 0,
          features: 0,
          personas: 0,
          apis: 0,
          code: 0,
          architecture: 0,
          database: 0,
          testCases: 0,
          requirements: 0,
          defects: 0,
          dom: 0,
          locators: 0,
          actions: 0,
          dataSetup: 0,
          auth: 0,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [setData, setLoading, setContextCounts]);

  // Apply theme class
  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
  }, [theme]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'test-cases':
        return <TestCases />;
      case 'sources':
        return <SourcesPage onViewAllJobs={() => setCurrentPage('sync-jobs')} />;
      case 'sync-jobs':
        return <SyncJobsPage onNavigateBack={() => setCurrentPage('sources')} />;
      case 'business':
        return <BusinessPage />;
      case 'business-flows':
        return <BusinessFlowsPage />;
      case 'business-facts':
        return <BusinessFactsPage />;
      case 'business-entities':
        return <BusinessEntitiesPage />;
      case 'business-rules':
        return <BusinessRulesPage />;
      case 'business-states':
        return <BusinessStatesPage />;
      case 'business-permissions':
        return <BusinessPermissionsPage />;
      case 'business-integrations':
        return <BusinessIntegrationsPage />;
      case 'business-constraints':
        return <BusinessConstraintsPage />;
      case 'business-configurations':
        return <BusinessConfigurationsPage />;
      case 'business-terminology':
        return <BusinessTerminologyPage />;
      // Technical
      case 'technical-apis':
        return <TechnicalApisPage />;
      case 'technical-code':
        return <TechnicalCodePage />;
      case 'technical-architecture':
        return <TechnicalArchitecturePage />;
      case 'technical-database':
        return <TechnicalDatabasePage />;
      // Quality
      case 'requirements':
        return <QualityRequirementsPage />;
      case 'defects':
        return <QualityDefectsPage />;
      // Automation
      case 'dom':
        return <AutomationDomPage />;
      case 'locators':
        return <AutomationLocatorsPage />;
      case 'actions':
        return <AutomationActionsPage />;
      case 'data-setup':
        return <AutomationDataSetupPage />;
      case 'auth':
        return <AutomationAuthPage />;
      // Product
      case 'features':
        return <ProductFeaturesPage />;
      case 'personas':
        return <ProductPersonasPage />;
      // Environments
      case 'environments':
        return <EnvironmentsPage />;
      // Agents
      case 'command-center':
        return <CommandCenterPage />;
      case 'agent-qae':
        return <QAEngineerPage />;
      case 'agent-aue':
        return <AutomationEngineerPage />;
      default:
        return <PlaceholderPage page={currentPage} />;
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent-purple animate-pulse" />
          <p className="text-text-secondary">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-canvas">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <main className="flex-1 overflow-hidden">
            {renderPage()}
          </main>
        </div>
        <Inspector />
      </div>

      {/* Overlays */}
      <CommandPalette />
      <NotificationCenter />
      <SuperQA />
    </div>
  );
}
