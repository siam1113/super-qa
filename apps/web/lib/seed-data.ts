import type { WorkspaceSeed } from './types';
export const seedWorkspace: WorkspaceSeed = {
  executions: [
    { testName:'TC-1042 Payment decline shows banner', flow:'Checkout / Payment', browser:'Chrome', environment:'Staging', status:'Failed', duration:'48s', retry:1, confidence:87, owner:'Maya Chen' },
    { testName:'TC-1001 Enterprise SSO login', flow:'Authentication / Login', browser:'Edge', environment:'Preview', status:'Passed', duration:'31s', retry:0, confidence:94, owner:'Ravi Patel' },
    { testName:'TC-1128 Archived user cannot checkout', flow:'Checkout / Confirmation', browser:'Firefox', environment:'Staging', status:'Blocked', duration:'16s', retry:0, confidence:77, owner:'Elena Garcia' },
    { testName:'TC-1177 Apply promotion code', flow:'Checkout / Add Item', browser:'Safari', environment:'Production', status:'Running', duration:'22s', retry:0, confidence:89, owner:'Noor Ahmed' }
  ],
  testCases: [
    { id:'TC-1001', title:'Login with valid enterprise SSO user', priority:'P0', automation:'Automated', owner:'Ravi Patel', flow:'Authentication / Login', tags:['sso','smoke'], lastRun:'12m ago', passRate:99, coverage:94, risk:'High', aiScore:94 },
    { id:'TC-1042', title:'Payment decline shows banner', priority:'P0', automation:'Automated', owner:'Maya Chen', flow:'Checkout / Payment', tags:['payments'], lastRun:'Failed', passRate:87, coverage:82, risk:'High', aiScore:89 },
    { id:'TC-1128', title:'Archived user cannot checkout', priority:'P1', automation:'Partial', owner:'Elena Garcia', flow:'Checkout / Confirmation', tags:['users'], lastRun:'2h ago', passRate:73, coverage:42, risk:'Medium', aiScore:77 }
  ],
  healing: [
    { issue:'Pay Now button locator changed', affectedTests:12, locator:'button[data-testid="pay-now"]', suggestedLocator:'getByRole(button, Pay now)', confidence:94, risk:'Low', owner:'Maya Chen' },
    { issue:'Toast role renamed', affectedTests:7, locator:'.toast-success', suggestedLocator:'getByText(Payment complete)', confidence:82, risk:'Medium', owner:'Ravi Patel' },
    { issue:'Email input moved into shadow DOM', affectedTests:4, locator:'#email', suggestedLocator:'locator(form).getByLabel(Email)', confidence:76, risk:'Medium', owner:'Noor Ahmed' }
  ],
  integrations: ['GitHub','Jira','Zephyr','Confluence','Notion','Azure DevOps','GitLab','Bitbucket','Postman','Swagger','Playwright','Cypress','Selenium','REST APIs','GraphQL','Database'].map((name, index) => ({ name, status: index === 2 ? 'Warning' : 'Connected', lastSync: `${index + 8} min ago`, permissions: index === 0 ? 'Read code, create PR' : 'Read/write sync' }))
};
