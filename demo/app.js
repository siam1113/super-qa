/* Super QA — interactive demo engine.
   Everything here is scripted/fake: no network calls, no backend. The goal is
   fidelity to the real app's navigation and flows (see apps/web/components/
   Sidebar.tsx, TopBar.tsx, AppShell.tsx and the Generate Test Cases / Agent
   Console / Executions flows), not literal code reuse — this file has none. */
(function () {
  'use strict';

  // ===================== Icons (inline SVG path sets, 24x24 viewBox) =====================
  const PATHS = {
    bot: '<rect x="4" y="9" width="16" height="11" rx="3"/><path d="M12 9V5"/><circle cx="12" cy="4" r="1.3" fill="currentColor"/><circle cx="9" cy="14.5" r="1.3" fill="currentColor"/><circle cx="15" cy="14.5" r="1.3" fill="currentColor"/>',
    listChecks: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="M4 6l0 0" />',
    testTube: '<path d="M9 2v8.5L4.5 18a3 3 0 0 0 2.6 4.5h9.8a3 3 0 0 0 2.6-4.5L15 10.5V2"/><path d="M9 2h6"/><path d="M7 16h10"/>',
    workflow: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M8.2 6h7.6M12 15.8V9"/>',
    layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v9"/>',
    code: '<path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/>',
    play: '<path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3 4.7-5.1"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r=".9" fill="currentColor"/><circle cx="7" cy="17" r=".9" fill="currentColor"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.5 12.5L20 3M16 7l2 2M13 10l2 2"/>',
    clipboardCheck: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 13l2 2 4-4.5"/>',
    bug: '<rect x="8" y="8" width="8" height="10" rx="4"/><path d="M8 11H5M19 11h-3M8 15H5M19 15h-3M10 8V6a2 2 0 0 1 4 0v2"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    construction: '<path d="M4 20l4-9 4 9M13 20l4-9 4 9M3 20h18M9 7h6l-1-4H10l-1 4z"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    external: '<path d="M14 5h5v5M19 5L10 14M8 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2"/>',
    gitPr: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5V18M6 9c0 4 4 4.5 8 4.5M18 11.5V9"/>',
  };
  function icon(name, size) {
    size = size || 15;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + PATHS[name] + '</svg>';
  }

  // ===================== Fake data =====================
  const AGENTS = {
    qae: { name: 'Alex', kind: 'qae', tone: 'var(--accent-blue)', toneSoft: 'var(--accent-blue-soft)' },
    aue: { name: 'Jordan', kind: 'aue', tone: 'var(--accent-purple)', toneSoft: 'var(--accent-purple-soft)' },
  };

  const DATA = {
    testCases: [
      { title: 'Checkout completes with a saved card', flow: 'Checkout', priority: 'P0', updated: '2h ago' },
      { title: 'Password reset email arrives within 60s', flow: 'Auth', priority: 'P1', updated: '1d ago' },
      { title: 'Invite teammate and accept via email link', flow: 'Onboarding', priority: 'P1', updated: '2d ago' },
      { title: 'Export report as CSV preserves filters', flow: 'Reporting', priority: 'P2', updated: '3d ago' },
      { title: 'Org owner can downgrade plan mid-cycle', flow: 'Billing', priority: 'P2', updated: '5d ago' },
      { title: 'Search returns results for partial matches', flow: 'Search', priority: 'P3', updated: '1w ago' },
    ],
    executions: [
      { id: 'run-1', name: 'Checkout flow — payment step', env: 'Staging', status: 'failed', duration: '41s' },
      { id: 'run-2', name: 'Password reset email arrives within 60s', env: 'Staging', status: 'passed', duration: '12s' },
      { id: 'run-3', name: 'Invite teammate and accept via email link', env: 'Staging', status: 'passed', duration: '28s' },
      { id: 'run-4', name: 'Export report as CSV preserves filters', env: 'Production', status: 'passed', duration: '19s' },
      { id: 'run-5', name: 'Org owner can downgrade plan mid-cycle', env: 'Staging', status: 'pending', duration: '—' },
      { id: 'run-6', name: 'Search returns results for partial matches', env: 'Production', status: 'passed', duration: '9s' },
    ],
    environments: [
      { name: 'Staging', url: 'https://herdly.byoursidee.com', isDefault: true },
      { name: 'Production', url: 'https://app.customer.com', isDefault: false },
      { name: 'Local Dev', url: 'http://localhost:3000', isDefault: false },
    ],
    outpost: [
      {
        activityName: 'Failure Pattern Digest', status: 'succeeded', triggeredBy: 'schedule', autonomy: 'observer',
        finding: 'Checkout flow — payment step has failed 3 of the last 5 runs on Staging, always at the "confirm card" click. Pattern suggests the confirm button\'s selector may have changed after Tuesday\'s release.',
      },
      {
        activityName: 'Coverage Gap Scan', status: 'succeeded', triggeredBy: 'schedule', autonomy: 'suggest',
        finding: 'Billing has 2 test cases but 6 distinct plan-change paths in the code. Proposed 4 new cases covering downgrade, proration, and failed-payment retry — pending your review.',
      },
    ],
  };

  const EXPLORE_ENVIRONMENTS = [
    { id: 'staging', label: 'Staging — https://herdly.byoursidee.com' },
    { id: 'production', label: 'Production — https://app.customer.com' },
    { id: 'local', label: 'Local Dev — http://localhost:3000' },
  ];

  const EXPLORE_STEPS = [
    { url: '/dashboard', title: 'Dashboard', kind: 'dashboard', result: 'Landed on the workspace dashboard — KPI tiles for passed/failed observations, pending executions, and healing reviews.' },
    { url: '/billing', title: 'Billing', kind: 'list', result: 'Found the Billing section: current plan, usage meter, and an "Change plan" control with 3 tiers.' },
    { url: '/billing/change-plan', title: 'Change plan', kind: 'form', result: 'Opened the plan-change dialog — tier selector, proration notice, and a confirm button gated behind a card-on-file check.' },
    { url: '/billing/invoices', title: 'Invoices', kind: 'list', result: 'Invoice history table with 14 rows, a date filter, and a per-row "Download PDF" action.' },
    { url: '/billing/payment-methods', title: 'Payment methods', kind: 'detail', result: 'One saved card on file. "Add payment method" opens a Stripe-hosted form in an iframe.' },
    { url: '/billing/downgrade-confirm', title: 'Downgrade confirm', kind: 'form', result: 'Downgrade requires typing the workspace name to confirm — matches the destructive-action pattern used elsewhere in the app.' },
  ];

  const CONSOLE_QUICK_ACTIONS = [
    { label: 'Biggest coverage gap?', command: 'coverage-gap' },
    { label: 'Any flaky tests this week?', command: 'flaky-tests' },
    { label: "Summarize today's failures", command: 'summarize-failures' },
  ];

  const CONSOLE_RESPONSES = {
    'coverage-gap': {
      tool: 'analyze_coverage(flow: "all")',
      text: "Billing is your biggest gap: 2 test cases cover 6 distinct plan-change paths I can see in the code (upgrade, downgrade, proration, failed-payment retry, cancel-then-reactivate, and seat-count changes). Checkout and Auth are both well covered relative to their complexity.\n\nWant me to explore the live billing flow and design cases from what I actually find there, instead of guessing from the code alone?",
    },
    'flaky-tests': {
      tool: 'query_executions(window: "7d", flakyOnly: true)',
      text: '"Checkout flow — payment step" failed 3 of its last 5 runs on Staging, always at the "confirm card" click — that\'s a real regression, not flake (consistent failure point, not random). Everything else executed cleanly all 5 times this week. I flagged the checkout failure in Outpost already; open it from the Outpost tab to see the proposed fix.',
    },
    'summarize-failures': {
      tool: 'query_executions(window: "24h", status: "failed")',
      text: 'One failure in the last 24 hours: "Checkout flow — payment step" on Staging, 41s runtime, failed confirming the payment with a saved card. I already proposed a self-healing locator fix for it — check Executions to review and approve.',
    },
    default: {
      tool: null,
      text: "That's outside what I've got scripted for this demo, but in the real app I'd pull from your actual test cases, executions, and code context to answer it directly — try one of the quick prompts above for a live example.",
    },
  };

  // ===================== Nav config (mirrors Sidebar.tsx) =====================
  const NAV = {
    organization: [
      { id: 'agents', label: 'Agents', icon: 'bot', tone: 'var(--accent-blue)', children: [
        { id: 'agent-qae', label: 'Alex', sub: 'QAE', icon: 'bot', tone: 'var(--accent-blue)', view: 'agent-console', agent: 'qae' },
        { id: 'agent-aue', label: 'Jordan', sub: 'AUE', icon: 'bot', tone: 'var(--accent-purple)', view: 'agent-console', agent: 'aue' },
      ] },
    ],
    app: [
      { id: 'plan', label: 'Plan', icon: 'listChecks', tone: 'var(--accent-blue)', children: [
        { id: 'test-cases', label: 'Test Cases', icon: 'testTube', tone: 'var(--accent-blue)', view: 'test-cases', badge: 6 },
        { id: 'execution-plans', label: 'Execution Plans', icon: 'workflow', tone: 'var(--info)', view: 'execution-plans' },
      ] },
      { id: 'automate', label: 'Automate', icon: 'layers', tone: 'var(--accent-purple)', children: [
        { id: 'framework', label: 'Framework', icon: 'box', tone: 'var(--accent-purple)', view: 'framework' },
        { id: 'automated-tests', label: 'Automated Tests', icon: 'code', tone: 'var(--info)', view: 'automated-tests' },
      ] },
      { id: 'execute', label: 'Execute', icon: 'play', tone: 'var(--success)', children: [
        { id: 'executions', label: 'Executions', icon: 'checkCircle', tone: 'var(--success)', view: 'executions' },
        { id: 'environments', label: 'Environments', icon: 'server', tone: 'var(--info)', view: 'environments' },
        { id: 'test-credentials', label: 'Test Credentials', icon: 'key', tone: 'var(--warning)', view: 'test-credentials' },
      ] },
      { id: 'review', label: 'Review', icon: 'clipboardCheck', tone: 'var(--warning)', children: [
        { id: 'defects', label: 'Defects', icon: 'bug', tone: 'var(--danger)', view: 'defects', badge: 3, badgeTone: 'warning' },
        { id: 'reports', label: 'Reports', icon: 'fileText', tone: 'var(--warning)', view: 'reports' },
        { id: 'coverage', label: 'Coverage', icon: 'target', tone: 'var(--accent-purple)', view: 'coverage' },
      ] },
    ],
  };

  const PLACEHOLDER_CONFIG = {
    'execution-plans': { title: 'Execution Plans', description: 'Build reusable plans that select test cases, data, and target environments.' },
    framework: { title: 'Setup', description: 'Configure framework conventions, shared helpers, and automation defaults for this app.' },
    'automated-tests': { title: 'Automated Tests', description: 'Browse runnable automated checks linked to app test cases and plans.' },
    'test-credentials': { title: 'Test Credentials', description: "Configure secure credential references for this app's test environments." },
    defects: { title: 'Defects', description: 'Track and triage issues found during execution or exploration.' },
    reports: { title: 'Reports', description: 'Review execution outcomes and quality trends for this app.' },
    coverage: { title: 'Coverage', description: 'Review coverage between app requirements, test cases, and executions.' },
    'command-center': { title: 'Command Center', description: 'See every agent session across your workspace in one place.' },
  };

  const PAGE_NAMES = {
    home: 'Home', 'test-cases': 'Test Cases', executions: 'Executions', environments: 'Environments',
    'execution-plans': 'Execution Plans', framework: 'Framework', 'automated-tests': 'Automated Tests',
    'test-credentials': 'Test Credentials', defects: 'Defects', reports: 'Reports', coverage: 'Coverage',
    'command-center': 'Command Center',
  };

  // ===================== State =====================
  const state = {
    view: 'home',
    expanded: new Set(['agents', 'plan', 'execute', 'automate', 'review']),
    consoleAgent: 'qae',
    consoleSeeded: { qae: false, aue: false },
    explore: null, // active exploration run state
  };

  // ===================== DOM helpers =====================
  const $ = (id) => document.getElementById(id);
  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }
  let toastTimer = null;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  // ===================== Sidebar =====================
  function renderSidebar() {
    const nav = $('sidebarNav');
    nav.innerHTML = '';
    NAV.organization.forEach((group) => nav.appendChild(renderNavGroup(group)));
    nav.appendChild(el('div', 'nav-divider'));
    NAV.app.forEach((group) => nav.appendChild(renderNavGroup(group)));
  }

  function groupContainsActive(group) {
    return group.children.some((child) => child.view === state.view && (!child.agent || child.agent === state.consoleAgent));
  }

  function renderNavGroup(group) {
    const wrap = el('div', 'nav-group');
    const isExpanded = state.expanded.has(group.id);
    const hasActive = groupContainsActive(group);
    const parent = el('button', 'nav-parent' + (hasActive ? ' has-active' : ''));
    parent.type = 'button';
    parent.innerHTML =
      '<span class="nav-icon-box" style="color:' + group.tone + '">' + icon(group.icon, 14) + '</span>' +
      '<span class="nav-parent-label">' + group.label + '</span>' +
      '<span class="nav-chevron">' + icon(isExpanded ? 'chevronDown' : 'chevronRight', 13) + '</span>';
    parent.title = group.label;
    parent.addEventListener('click', () => {
      if (state.expanded.has(group.id)) state.expanded.delete(group.id); else state.expanded.add(group.id);
      renderSidebar();
    });
    wrap.appendChild(parent);

    const children = el('div', 'nav-children' + (isExpanded ? '' : ' closed'));
    group.children.forEach((child) => {
      const active = child.view === state.view && (!child.agent || child.agent === state.consoleAgent);
      const btn = el('button', 'nav-item' + (active ? ' active' : ''));
      btn.type = 'button';
      btn.title = child.sub ? child.label + ' (' + child.sub + ')' : child.label;
      // Test Cases' count is the one nav badge the demo can actually change (the
      // Generate-with-AI flow adds rows to DATA.testCases) — read it live instead of
      // the static seed value so the sidebar never drifts from what's on the page.
      const badgeValue = child.id === 'test-cases' ? DATA.testCases.length : child.badge;
      let badge = '';
      if (badgeValue !== undefined) badge = '<span class="nav-badge' + (child.badgeTone ? ' ' + child.badgeTone : '') + '">' + badgeValue + '</span>';
      btn.innerHTML =
        '<span class="nav-item-icon" style="color:' + child.tone + '">' + icon(child.icon, 14) + '</span>' +
        '<span class="nav-item-label">' + child.label + (child.sub ? ' <span style="opacity:.55;font-size:11px">' + child.sub + '</span>' : '') + '</span>' + badge;
      btn.addEventListener('click', () => {
        if (child.agent) openConsole(child.agent);
        else setView(child.view);
      });
      children.appendChild(btn);
    });
    wrap.appendChild(children);
    return wrap;
  }

  // ===================== View switching =====================
  function setView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
    $('breadcrumbCurrent').textContent = view === 'agent-console' ? AGENTS[state.consoleAgent].name : (PAGE_NAMES[view] || view);
    renderSidebar();
    $('content').scrollTop = 0;
    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// origin may block history API */ }
  }

  function openConsole(agentKind) {
    state.consoleAgent = agentKind;
    seedConsoleIfNeeded(agentKind);
    renderConsole();
    renderOutpost();
    setView('agent-console');
  }

  // ===================== Home =====================
  function wireHome() {
    document.querySelectorAll('[data-launch]').forEach((btn) => btn.addEventListener('click', () => {
      const flow = btn.dataset.launch;
      if (flow === 'flow-explore') { setView('test-cases'); setTimeout(openWizard, 150); }
      else if (flow === 'flow-chat') { openConsole('qae'); }
      else if (flow === 'flow-heal') { setView('executions'); setTimeout(() => openExecDetail('run-1'), 150); }
    }));
    document.querySelectorAll('[data-view-link]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.viewLink)));
    $('btnGoHome').addEventListener('click', () => setView('home'));
  }

  // ===================== Test Cases =====================
  function renderTestCases() {
    const list = $('testCaseList');
    list.innerHTML = '';
    DATA.testCases.forEach((tc) => {
      const row = el('div', 'tc-row');
      row.innerHTML =
        '<div><div class="title">' + tc.title + '</div><div class="meta">' + tc.flow + ' · updated ' + tc.updated + '</div></div>' +
        '<div class="spacer"></div><span class="pill pill-neutral">' + tc.priority + '</span>';
      list.appendChild(row);
    });
  }

  // ===================== Executions =====================
  const STATUS_TONE = { passed: 'passed', failed: 'failed', pending: 'pending' };
  const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', pending: 'Pending' };
  function renderExecutions() {
    const list = $('executionList');
    list.innerHTML = '';
    DATA.executions.forEach((run) => {
      const row = el('button', 'table-row');
      row.type = 'button';
      row.innerHTML =
        '<span class="exec-row"><span class="status-dot status-' + STATUS_TONE[run.status] + '"></span>' +
        '<span>' + run.name + '</span></span>' +
        '<span style="display:flex;align-items:center;gap:14px;color:var(--text-secondary);font-size:12.5px">' +
        '<span>' + run.env + '</span><span>' + run.duration + '</span>' +
        '<span class="pill pill-' + (run.status === 'failed' ? 'danger' : run.status === 'pending' ? 'neutral' : 'success') + '">' + STATUS_LABEL[run.status] + '</span></span>';
      row.addEventListener('click', () => openExecDetail(run.id));
      list.appendChild(row);
    });
  }

  function openExecDetail(runId) {
    const run = DATA.executions.find((item) => item.id === runId);
    if (!run) return;
    $('execModalTitle').textContent = run.name;
    const body = $('execModalBody');
    const foot = $('execModalFoot');
    foot.innerHTML = '';

    if (run.status !== 'failed') {
      body.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
        '<span class="pill pill-success">Passed</span><span style="color:var(--text-secondary);font-size:13px">' + run.env + ' · ' + run.duration + '</span></div>' +
        '<p style="font-size:13.5px;color:var(--text-secondary);line-height:1.7">Every assertion in this run passed with no retries. Nothing to investigate.</p>';
      const closeBtn = el('button', 'btn btn-secondary', 'Close');
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', closeExecModal);
      foot.appendChild(closeBtn);
      $('execScrim').classList.remove('hidden');
      return;
    }

    let stage = 0;
    function renderStage() {
      let html =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span class="pill pill-danger">Failed</span><span style="color:var(--text-secondary);font-size:13px">' + run.env + ' · ' + run.duration + '</span></div>' +
        '<div class="card card-pad" style="margin-bottom:14px">' +
        '<p style="font-size:13px;font-weight:500;margin:0 0 6px">Error</p>' +
        '<p style="font-size:13px;color:var(--text-secondary);margin:0;font-family:\'JetBrains Mono\',monospace">TimeoutError: element not found for selector <code>button.confirm-payment-btn</code> after 10000ms</p>' +
        '</div>';

      if (stage >= 1) {
        html +=
          '<div class="heal-step done"><div class="num">' + icon('checkCircle', 13) + '</div><div><h4>AI root-cause analysis</h4>' +
          '<p>The checkout page shipped a UI update Tuesday that renamed the payment confirm button\'s class from <code>confirm-payment-btn</code> to <code>confirm-payment-action</code> — the test\'s locator never changed, so it now matches nothing. This is a locator drift, not a product bug: the button still works when clicked manually. 2 other runs this week failed at the identical step.</p></div></div>';
      }
      if (stage >= 2) {
        html +=
          '<div class="heal-step done"><div class="num">' + icon('checkCircle', 13) + '</div><div><h4>Self-healing fix proposed</h4>' +
          '<p>Swap the brittle class selector for a stable, role-based locator that survives future class-name changes.</p>' +
          '<div class="code-block"><span class="del">- page.click(\'button.confirm-payment-btn\')</span><span class="add">+ page.getByRole(\'button\', { name: \'Confirm payment\' }).click()</span></div></div></div>';
      }
      if (stage >= 3) {
        html +=
          '<div class="pr-success"><span class="icon-box" style="width:36px;height:36px;border-radius:50%">' + icon('gitPr', 17) + '</span>' +
          '<div><p style="font-size:13.5px;font-weight:600;margin:0">PR #482 opened — "Heal: role-based locator for payment confirm"</p>' +
          '<p style="font-size:12.5px;color:var(--text-secondary);margin:4px 0 0">Approved by you · merges the locator fix only, no assertions touched · re-run queued on merge</p></div></div>';
      }
      body.innerHTML = html;

      foot.innerHTML = '';
      if (stage === 0) {
        const btn = el('button', 'btn btn-primary', 'Investigate with AI');
        btn.type = 'button'; btn.addEventListener('click', () => { stage = 1; renderStage(); });
        foot.appendChild(btn);
      } else if (stage === 1) {
        const btn = el('button', 'btn btn-primary', 'Propose self-heal fix');
        btn.type = 'button'; btn.addEventListener('click', () => { stage = 2; renderStage(); });
        foot.appendChild(btn);
      } else if (stage === 2) {
        const btn = el('button', 'btn btn-primary', 'Approve & open PR');
        btn.type = 'button'; btn.addEventListener('click', () => { stage = 3; renderStage(); toast('PR #482 opened'); });
        foot.appendChild(btn);
      } else {
        const btn = el('button', 'btn btn-secondary', 'Close');
        btn.type = 'button'; btn.addEventListener('click', closeExecModal);
        foot.appendChild(btn);
      }
    }
    renderStage();
    $('execScrim').classList.remove('hidden');
  }
  function closeExecModal() { $('execScrim').classList.add('hidden'); }

  // ===================== Environments =====================
  function renderEnvironments() {
    const list = $('environmentList');
    list.innerHTML = '';
    DATA.environments.forEach((env) => {
      const row = el('div', 'table-row');
      row.innerHTML =
        '<span style="display:flex;align-items:center;gap:10px"><span class="icon-box" style="width:30px;height:30px;background:var(--info-soft);color:var(--info)">' + icon('server', 15) + '</span>' +
        '<span><div style="font-weight:500">' + env.name + '</div><div style="font-size:12px;color:var(--text-secondary)">' + env.url + '</div></span></span>' +
        (env.isDefault ? '<span class="pill pill-info">Default</span>' : '');
      list.appendChild(row);
    });
  }

  // ===================== Agent console =====================
  function seedConsoleIfNeeded(agentKind) {
    if (state.consoleSeeded[agentKind]) return;
    state.consoleSeeded[agentKind] = true;
  }

  function renderConsole() {
    const log = $('consoleLog');
    log.innerHTML = '';
    const agent = AGENTS[state.consoleAgent];
    appendConsoleMessage('agent', agent.name + ' is ready. Ask about coverage, flaky tests, or recent failures — or try a prompt below.', null, false);
    const quick = $('consoleQuick');
    quick.innerHTML = '';
    CONSOLE_QUICK_ACTIONS.forEach((item) => {
      const btn = el('button', '', item.label);
      btn.type = 'button';
      btn.addEventListener('click', () => sendConsoleMessage(item.label, item.command));
      quick.appendChild(btn);
    });
  }

  function appendConsoleMessage(role, text, toolLine, animate) {
    const log = $('consoleLog');
    const wrap = el('div', 'console-msg' + (animate ? ' fade-in' : ''));
    const roleLabel = role === 'user' ? 'instruction' : 'stdout';
    const roleClass = role === 'user' ? 'role-user' : 'role-agent';
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    let toolHtml = '';
    if (toolLine) toolHtml = '<div class="console-tool"><span class="dot"></span>' + toolLine + '</div>';
    wrap.innerHTML =
      '<div class="console-msg-meta"><span class="' + roleClass + '">' + roleLabel + '</span><time>' + time + '</time></div>' +
      toolHtml +
      '<div class="console-msg-body ' + (role === 'user' ? 'user' : 'agent') + '">' + escapeHtml(text) + '</div>';
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sendConsoleMessage(text, intentKey) {
    if (!text || !text.trim()) return;
    appendConsoleMessage('user', text.trim(), null, true);
    $('consoleInput').value = '';
    const thinking = appendConsoleMessage('agent', '', 'thinking…', true);
    setTimeout(() => {
      const response = CONSOLE_RESPONSES[intentKey] || CONSOLE_RESPONSES.default;
      thinking.remove();
      appendConsoleMessage('agent', response.text, response.tool, true);
    }, 900);
  }

  function renderOutpost() {
    const list = $('outpostList');
    list.innerHTML = '';
    DATA.outpost.forEach((run) => {
      const card = el('div', 'outpost-run');
      card.innerHTML =
        '<div class="head"><h4>' + run.activityName + '</h4>' +
        '<span class="pill pill-success">' + run.status + '</span>' +
        '<span class="pill pill-neutral">' + run.autonomy + '</span></div>' +
        '<div class="meta"><span>Triggered: ' + run.triggeredBy + '</span></div>' +
        '<p class="finding">' + run.finding + '</p>';
      const openBtn = el('button', 'btn btn-secondary btn-sm', icon('external', 12) + ' Open Console session');
      openBtn.style.marginTop = '10px';
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => {
        setConsoleTab('console');
        appendConsoleMessage('agent', run.finding, run.activityName + ' (Outpost finding)', true);
        toast('Opened in Console');
      });
      card.appendChild(openBtn);
      list.appendChild(card);
    });
  }

  function setConsoleTab(tab) {
    document.querySelectorAll('[data-console-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.consoleTab === tab));
    $('consoleTabConsole').classList.toggle('hidden', tab !== 'console');
    $('consoleTabOutpost').classList.toggle('hidden', tab !== 'outpost');
  }

  function wireConsole() {
    document.querySelectorAll('[data-console-tab]').forEach((btn) => btn.addEventListener('click', () => setConsoleTab(btn.dataset.consoleTab)));
    $('btnConsoleSend').addEventListener('click', () => sendConsoleMessage($('consoleInput').value, null));
    $('consoleInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendConsoleMessage($('consoleInput').value, null); }
    });
  }

  // ===================== Generate Test Cases wizard =====================
  function openWizard() {
    renderWizardChoose();
    $('wizardScrim').classList.remove('hidden');
  }
  function closeWizard() { $('wizardScrim').classList.add('hidden'); }

  function renderWizardChoose() {
    $('wizardTitle').textContent = 'Generate test cases';
    $('wizardPanel').classList.remove('wide');
    $('wizardBody').innerHTML =
      '<p style="font-size:13px;color:var(--text-secondary);margin:0 0 16px">How should Alex design these test cases?</p>' +
      '<div class="method-grid">' +
      methodCard('instruction', 'Describe it', 'Plain-language instructions') +
      methodCard('ticket', 'From a ticket', 'Ground it in a Jira issue') +
      methodCard('exploration', 'Explore live app', 'Watch Alex navigate it live') +
      '</div>';
    $('wizardFoot').innerHTML = '';
    document.querySelectorAll('.method-card').forEach((card) => card.addEventListener('click', () => {
      if (card.dataset.method === 'exploration') renderWizardConfigure();
      else toast('This demo spotlights the live-exploration flow — try "Explore live app"');
    }));
  }
  function methodCard(method, title, sub) {
    const iconName = method === 'instruction' ? 'fileText' : method === 'ticket' ? 'clipboardCheck' : 'target';
    return '<button type="button" class="method-card" data-method="' + method + '"><span class="m-icon">' + icon(iconName, 17) + '</span><b>' + title + '</b><span>' + sub + '</span></button>';
  }

  function renderWizardConfigure() {
    $('wizardTitle').textContent = 'Explore a live app';
    $('wizardBody').innerHTML =
      '<div class="field"><label>Environment</label><select class="field-input" id="wizEnv">' +
      EXPLORE_ENVIRONMENTS.map((e) => '<option value="' + e.id + '">' + e.label + '</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Start path <span style="opacity:.6">(optional)</span></label><input class="field-input" id="wizPath" placeholder="/billing" /></div>' +
      '<div class="field"><label>Focus <span style="opacity:.6">(optional)</span></label><textarea class="field-input" id="wizFocus" rows="2" placeholder="e.g. the billing and plan-change flow"></textarea></div>' +
      '<div class="field"><label>Exploration depth</label><select class="field-input" id="wizDepth">' +
      '<option value="quick">Quick — confirm it exists, move on</option>' +
      '<option value="standard" selected>Standard — try a couple of key controls</option>' +
      '<option value="deep">Deep — work through sub-tabs and filters</option>' +
      '<option value="exhaustive">Exhaustive — try everything before concluding</option>' +
      '</select></div>' +
      '<p class="field-hint">Alex opens a real browser against the selected environment, navigates it live, and designs test cases only from what it actually observes — never invented.</p>';
    $('wizardFoot').innerHTML = '';
    const back = el('button', 'btn btn-secondary', 'Back');
    back.type = 'button'; back.addEventListener('click', renderWizardChoose);
    const go = el('button', 'btn btn-primary', 'Explore & Generate');
    go.type = 'button'; go.addEventListener('click', () => {
      const focus = $('wizFocus').value.trim();
      closeWizard();
      startExploration(focus);
    });
    $('wizardFoot').appendChild(back);
    $('wizardFoot').appendChild(go);
  }

  function renderWizardReview(pagesSeen, stopped) {
    $('wizardTitle').textContent = 'Review generated test cases';
    $('wizardPanel').classList.add('wide');
    const proposals = buildProposals(pagesSeen);
    let note = '';
    if (stopped && pagesSeen < 3) {
      note = '<div class="explore-confirm" style="margin-bottom:14px"><p class="warn">Only ' + pagesSeen + ' page(s) were explored before stopping — these cases may be shallow. You can always explore further and regenerate.</p></div>';
    }
    $('wizardBody').innerHTML = note +
      '<p style="font-size:13px;color:var(--text-secondary);margin:0 0 14px">Grounded in what Alex actually saw exploring Billing (' + pagesSeen + ' page' + (pagesSeen === 1 ? '' : 's') + ' visited). Nothing here was invented.</p>' +
      '<div class="proposal-list">' + proposals.map((p, i) => proposalHtml(p, i)).join('') + '</div>';
    $('wizardFoot').innerHTML = '';
    const addBtn = el('button', 'btn btn-primary', 'Add selected to suite');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      const checked = Array.from(document.querySelectorAll('.proposal input[type=checkbox]:checked')).length;
      proposals.forEach((p, i) => {
        const box = document.getElementById('prop-' + i);
        if (box && box.checked) DATA.testCases.unshift({ title: p.title, flow: 'Billing', priority: p.priority, updated: 'just now' });
      });
      closeWizard();
      renderTestCases();
      setView('test-cases');
      toast('Added ' + checked + ' test case' + (checked === 1 ? '' : 's') + ' to the suite');
    });
    $('wizardFoot').appendChild(addBtn);
    $('wizardScrim').classList.remove('hidden');
  }
  function proposalHtml(p, i) {
    return '<div class="proposal"><input type="checkbox" id="prop-' + i + '" checked />' +
      '<div><div class="pt">' + p.title + '</div><div class="ps">' + p.steps + '</div>' +
      '<div class="pbadges"><span class="pill pill-neutral">' + p.priority + '</span><span class="pill pill-' + p.riskTone + '">' + p.risk + ' risk</span></div></div></div>';
  }
  function buildProposals(pagesSeen) {
    const all = [
      { title: 'Change plan shows proration before confirming', steps: '3 steps · open Change plan, select a higher tier, verify proration notice renders', priority: 'P1', risk: 'medium', riskTone: 'warning' },
      { title: 'Downgrade requires typing workspace name to confirm', steps: '4 steps · start downgrade, verify confirm is disabled until name matches', priority: 'P1', risk: 'high', riskTone: 'danger' },
      { title: 'Invoice PDF download succeeds for a past invoice', steps: '3 steps · open Invoices, pick a row, download, verify file is produced', priority: 'P2', risk: 'low', riskTone: 'success' },
      { title: 'Adding a payment method via the Stripe iframe', steps: '4 steps · open Payment methods, add card, verify it appears as default-eligible', priority: 'P2', risk: 'medium', riskTone: 'warning' },
    ];
    return all.slice(0, Math.max(1, Math.min(all.length, pagesSeen >= 5 ? 4 : pagesSeen >= 3 ? 3 : 2)));
  }

  // ===================== Live exploration viewer =====================
  function mockPage(step) {
    const chrome = '<div style="position:absolute;top:0;left:0;right:0;height:30px;background:#0d131a;display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid #1c2733">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:#3a4756"></span><span style="width:9px;height:9px;border-radius:50%;background:#3a4756"></span><span style="width:9px;height:9px;border-radius:50%;background:#3a4756"></span>' +
      '<span style="margin-left:8px;font-size:11px;color:#6b7c8f;font-family:\'JetBrains Mono\',monospace">herdly.byoursidee.com' + step.url + '</span></div>';
    let body = '';
    if (step.kind === 'dashboard') {
      body = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px">' +
        [1, 2, 3].map(() => '<div style="background:#111a24;border-radius:8px;height:64px;border:1px solid #1c2733"></div>').join('') +
        '<div style="grid-column:1/-1;background:#111a24;border-radius:8px;height:120px;border:1px solid #1c2733"></div></div>';
    } else if (step.kind === 'list') {
      body = '<div style="padding:16px"><div style="height:16px;width:140px;background:#1c2733;border-radius:4px;margin-bottom:14px"></div>' +
        [1, 2, 3, 4].map((i) => '<div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #1c2733"><div style="width:28px;height:28px;border-radius:6px;background:#1c2733"></div><div style="flex:1"><div style="height:10px;width:' + (60 - i * 5) + '%;background:#1c2733;border-radius:3px"></div></div></div>').join('') + '</div>';
    } else if (step.kind === 'form') {
      body = '<div style="padding:18px;max-width:280px"><div style="height:14px;width:120px;background:#1c2733;border-radius:4px;margin-bottom:16px"></div>' +
        [1, 2, 3].map(() => '<div style="height:34px;background:#111a24;border:1px solid #1c2733;border-radius:6px;margin-bottom:10px"></div>').join('') +
        '<div style="height:34px;width:110px;background:var(--accent-blue);border-radius:6px;margin-top:6px"></div></div>';
    } else {
      body = '<div style="padding:18px;display:flex;gap:16px"><div style="width:72px;height:72px;border-radius:10px;background:#1c2733;flex:none"></div>' +
        '<div style="flex:1"><div style="height:12px;width:70%;background:#1c2733;border-radius:4px;margin-bottom:8px"></div><div style="height:12px;width:50%;background:#1c2733;border-radius:4px"></div></div></div>';
    }
    return '<div style="position:absolute;inset:0;background:#0a0f16;border-radius:10px;overflow:auto">' + chrome + '<div style="padding-top:30px;min-height:100%">' + body + '</div></div>';
  }

  // Appends the next canned page to an in-progress run and schedules the one after
  // it — the single step-advance implementation shared by the initial run, resuming
  // from pause, and continuing after "Keep exploring", so the three call sites can
  // never drift out of sync with each other.
  function stepForward(run, delayMs) {
    if (run.stopped) return;
    if (run.index >= EXPLORE_STEPS.length) { finishExploration(false); return; }
    const step = EXPLORE_STEPS[run.index];
    run.pages.push(step);
    run.index += 1;
    $('exploreStatus').textContent = 'Visited ' + run.pages.length + ' page' + (run.pages.length === 1 ? '' : 's') + ' so far';
    const stepsPanel = $('exploreSteps');
    const row = el('div', 'explore-step fade-in');
    row.innerHTML = '<div class="n">' + run.pages.length + '. ' + step.title + '</div><div class="r">' + step.result + '</div>';
    stepsPanel.appendChild(row);
    stepsPanel.scrollTop = stepsPanel.scrollHeight;
    $('exploreFrameWrap').innerHTML = mockPage(step);
    run.timer = setTimeout(() => stepForward(run, 2200), delayMs || 2200);
  }

  function startExploration(focus) {
    const run = { pages: [], index: 0, paused: false, stopped: false, timer: null };
    state.explore = run;
    $('exploreAgentName').textContent = AGENTS.qae.name;
    $('exploreDot').classList.add('on');
    $('exploreStatus').textContent = 'Starting…';
    $('exploreSteps').innerHTML = '';
    $('exploreConfirmSlot').innerHTML = '';
    $('exploreFrameWrap').innerHTML = '<div class="explore-waiting" id="exploreWaiting"><span class="spin">' + icon('checkCircle', 14) + '</span> Waiting for the first page…</div>';
    $('btnExplorePause').textContent = 'Pause';
    $('btnExplorePause').disabled = false;
    $('btnExploreStop').disabled = false;
    $('exploreScrim').classList.remove('hidden');
    run.timer = setTimeout(() => stepForward(run), 900);
  }

  function finishExploration(stoppedByUser) {
    const run = state.explore;
    if (!run) return;
    clearTimeout(run.timer);
    run.stopped = true;
    $('exploreStatus').textContent = stoppedByUser ? 'Stopping — generating from what\'s been explored…' : 'Exploration complete — designing test cases…';
    $('btnExplorePause').disabled = true;
    $('btnExploreStop').disabled = true;
    setTimeout(() => {
      $('exploreScrim').classList.add('hidden');
      renderWizardReview(run.pages.length, stoppedByUser);
      state.explore = null;
    }, 1100);
  }

  function wireExploreViewer() {
    $('btnExplorePause').addEventListener('click', () => {
      const run = state.explore;
      if (!run || run.stopped) return;
      run.paused = !run.paused;
      if (run.paused) {
        clearTimeout(run.timer);
        $('btnExplorePause').textContent = 'Resume';
        $('exploreStatus').textContent = 'Paused — visited ' + run.pages.length + ' page' + (run.pages.length === 1 ? '' : 's');
        $('exploreDot').classList.remove('on');
      } else {
        $('btnExplorePause').textContent = 'Pause';
        $('exploreDot').classList.add('on');
        $('exploreStatus').textContent = 'Visited ' + run.pages.length + ' page' + (run.pages.length === 1 ? '' : 's') + ' so far';
        run.timer = setTimeout(() => stepForward(run), 1400);
      }
    });

    $('btnExploreStop').addEventListener('click', () => {
      const run = state.explore;
      if (!run || run.stopped) return;
      clearTimeout(run.timer);
      const pagesSeen = run.pages.length;
      const thin = pagesSeen < 2;
      $('btnExplorePause').disabled = true;
      $('exploreConfirmSlot').innerHTML =
        '<div class="explore-confirm fade-in"><div class="t">' + icon('square', 12) + ' Stop exploring?</div>' +
        '<p>Generate test cases from the ' + pagesSeen + ' page' + (pagesSeen === 1 ? '' : 's') + ' explored so far?</p>' +
        (thin ? '<p class="warn">Only ' + pagesSeen + ' page(s) explored — the generated cases may be shallow since so little of the app has been seen. Consider exploring further instead.</p>' : '') +
        '<div class="actions"><button type="button" class="btn btn-primary btn-sm" id="btnStopConfirm">Generate from what I have</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="btnStopCancel">Keep exploring</button></div></div>';
      $('btnStopConfirm').addEventListener('click', () => finishExploration(true));
      $('btnStopCancel').addEventListener('click', () => {
        $('exploreConfirmSlot').innerHTML = '';
        $('btnExplorePause').disabled = false;
        run.timer = setTimeout(() => stepForward(run), 900);
      });
    });
  }

  // ===================== Placeholder pages =====================
  function injectPlaceholderViews() {
    const content = $('content');
    Object.keys(PLACEHOLDER_CONFIG).forEach((view) => {
      const cfg = PLACEHOLDER_CONFIG[view];
      const section = el('section', 'view');
      section.dataset.view = view;
      section.innerHTML =
        '<div class="placeholder-wrap"><div class="placeholder-inner">' +
        '<div class="placeholder-icon">' + icon('construction', 40) + '</div>' +
        '<h1>' + cfg.title + '</h1><p>' + cfg.description + '</p>' +
        '<div class="placeholder-tag">' + icon('construction', 15) + ' <span>Coming soon in your live workspace</span></div>' +
        '</div></div>';
      content.appendChild(section);
    });
  }

  // ===================== Topbar =====================
  function wireTopbar() {
    $('btnCollapseSidebar').addEventListener('click', () => {
      $('sidebar').classList.toggle('collapsed');
      $('btnCollapseSidebar').textContent = $('sidebar').classList.contains('collapsed') ? '›' : '‹';
    });
    $('btnSearch').addEventListener('click', () => toast('⌘K search — click through the sidebar in this demo instead'));
    $('btnBell').addEventListener('click', () => toast('2 unread: a failed run and a coverage-gap finding from Outpost'));
    $('btnAvatar').addEventListener('click', () => toast('Signed in as demo@superqa.dev'));
    $('btnTopChat').addEventListener('click', () => openConsole('qae'));
    $('btnTopCommandCenter').addEventListener('click', () => setView('command-center'));
    $('btnTheme').addEventListener('click', () => {
      const light = document.body.classList.toggle('light');
      $('iconMoon').innerHTML = light ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/>' : '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';
      try { localStorage.setItem('superqa-demo-theme', light ? 'light' : 'dark'); } catch (e) { /* storage unavailable */ }
    });
  }

  // ===================== Modal wiring =====================
  function wireModals() {
    $('btnWizardClose').addEventListener('click', closeWizard);
    $('wizardScrim').addEventListener('click', (event) => { if (event.target === $('wizardScrim')) closeWizard(); });
    $('btnExecClose').addEventListener('click', closeExecModal);
    $('execScrim').addEventListener('click', (event) => { if (event.target === $('execScrim')) closeExecModal(); });
    $('btnNewCase').addEventListener('click', () => toast('Creating a case by hand — not wired up in this demo; try "Generate with AI"'));
    $('btnGenerateAI').addEventListener('click', openWizard);
  }

  // ===================== Init =====================
  function init() {
    try { if (localStorage.getItem('superqa-demo-theme') === 'light') { document.body.classList.add('light'); $('iconMoon').innerHTML = '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/>'; } } catch (e) { /* storage unavailable */ }
    injectPlaceholderViews();
    renderSidebar();
    renderTestCases();
    renderExecutions();
    renderEnvironments();
    wireHome();
    wireTopbar();
    wireModals();
    wireConsole();
    wireExploreViewer();
    const initial = (location.hash || '').replace('#', '');
    if (initial === 'agent-console') openConsole('qae');
    else setView(initial && (PAGE_NAMES[initial] || PLACEHOLDER_CONFIG[initial]) ? initial : 'home');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
