// Super QA — scripted product walkthrough engine.
// Everything here is a fake, timed sequence against static markup. No network calls, no real agents.
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const icon = (path, extra) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra||''}>${path}</svg>`;

  const ICONS = {
    play: icon('<path d="M6 4l15 8-15 8V4z" fill="currentColor" stroke="none"/>'),
    pause: icon('<rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor" stroke="none"/>'),
    restart: icon('<path d="M3 12a9 9 0 1 0 2.6-6.3M3 4v5h5"/>'),
    calendar: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    sparkles: icon('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>'),
    rocket: icon('<path d="M12 2c3 1 5 4 5 8 0 3-1.5 5.5-3 7l-2 2-2-2c-1.5-1.5-3-4-3-7 0-4 2-7 5-8z"/><path d="M9 15l-3 3 1 3 3-1M15 15l3 3-1 3-3-1"/>'),
    check: icon('<path d="M20 6L9 17l-5-5"/>'),
  };

  // ---------- engine state ----------
  // PACE scales every scripted delay uniformly — bump this up to slow the whole
  // tour down (or down to speed it up) without re-tuning individual steps.
  const PACE = 2.2;

  const state = {
    paused: false,
    runToken: 0,
    autoAdvance: true,
    currentScene: 0,
  };

  function sleep(ms, token) {
    ms = ms * PACE;
    return new Promise((resolve) => {
      let remaining = ms;
      (function step() {
        if (token !== state.runToken) return resolve();
        if (state.paused) { setTimeout(step, 90); return; }
        const chunk = Math.min(90, remaining);
        remaining -= chunk;
        if (remaining <= 0) setTimeout(resolve, chunk);
        else setTimeout(step, chunk);
      })();
    });
  }

  function countUp(els, targets, suffixes, duration) {
    duration = duration * PACE;
    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        els.forEach((el, i) => { el.textContent = Math.round(targets[i] * t) + (suffixes[i] || ''); });
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function setCaption(text) {
    const el = qs('#captionText');
    if (el) el.textContent = text;
  }

  function showToast(stackId, message) {
    const stack = qs('#' + stackId);
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon('<path d="M20 6L9 17l-5-5"/>')}<span>${message}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease, transform .3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 320);
    }, 3800 * PACE);
  }

  function bumpKpi(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    const val = parseInt(el.textContent, 10) || 0;
    el.textContent = String(val + delta);
  }

  // ---------- chapters ----------
  const chapters = [
    { idx: 1, tag: 'Context Manager', name: 'Connect & Learn' },
    { idx: 2, tag: 'Test Case Manager', name: 'Generate Coverage' },
    { idx: 3, tag: 'Executor', name: 'Execute' },
    { idx: 4, tag: 'Executor', name: 'Investigate' },
    { idx: 5, tag: 'Healer', name: 'Self-Heal' },
    { idx: 6, tag: 'Dashboard', name: 'Ship It' },
  ];

  function renderChapters() {
    const rail = qs('#chapters');
    rail.innerHTML = '';
    chapters.forEach((ch) => {
      const btn = document.createElement('button');
      btn.className = 'chapter-btn';
      btn.dataset.idx = String(ch.idx);
      btn.innerHTML = `<span class="ch-top"><span>${ch.tag}</span></span><span class="ch-name">${ch.name}</span>`;
      btn.addEventListener('click', () => {
        goToScene(ch.idx);
      });
      rail.appendChild(btn);
    });
  }

  function updateChapterUI(activeIdx) {
    qsa('.chapter-btn').forEach((btn) => {
      const idx = parseInt(btn.dataset.idx, 10);
      btn.classList.remove('is-active', 'is-done');
      if (idx < activeIdx) btn.classList.add('is-done');
      if (idx === activeIdx) btn.classList.add('is-active');
    });
    const pct = Math.max(0, Math.min(100, ((activeIdx - 1) / chapters.length) * 100));
    qs('#progressFill').style.width = pct + '%';
  }

  function finishProgressFor(idx) {
    const pct = (idx / chapters.length) * 100;
    qs('#progressFill').style.width = pct + '%';
  }

  function showScene(index) {
    qsa('.scene').forEach((s) => s.classList.remove('active'));
    qs('#scene-' + index).classList.add('active');
    state.currentScene = index;
  }

  // ======================================================================
  // SCENE 1 — Connect & Learn
  // ======================================================================
  const sourcesOrder = ['github', 'jira', 'confluence', 'zephyr'];
  const sourceLabels = { github: 'GitHub', jira: 'Jira', confluence: 'Confluence', zephyr: 'Zephyr' };
  const factsData = [
    { text: 'A locked account cannot start checkout.', conf: 96, source: 'Confluence · Checkout Requirements' },
    { text: 'Enterprise SSO users bypass the password reset flow.', conf: 91, source: 'Jira · AUTH-188' },
    { text: 'Declined payments must show a retry affordance within 2s.', conf: 88, source: 'Confluence · Payment SLAs' },
  ];

  function resetScene1() {
    sourcesOrder.forEach((key) => {
      const card = qs(`.source-card[data-source="${key}"]`);
      card.classList.remove('connected');
      const statusEl = qs('[data-status]', card);
      statusEl.classList.remove('is-connected');
      statusEl.textContent = 'Not connected';
    });
    qs('#factsList').innerHTML = '';
    const clarify = qs('#clarifyCard');
    clarify.classList.add('hidden');
    qs('#clarifyActions [data-choice="merge"]').classList.remove('chip-active');
    const result = qs('#clarifyResult');
    result.classList.add('hidden');
    result.innerHTML = '';
  }

  function stepConnectSource(key) {
    return async (token) => {
      const card = qs(`.source-card[data-source="${key}"]`);
      const statusEl = qs('[data-status]', card);
      statusEl.innerHTML = '<span class="spin-ico"></span> Connecting…';
      setCaption(`Connecting to ${sourceLabels[key]}…`);
      await sleep(550, token);
      if (token !== state.runToken) return;
      card.classList.add('connected');
      statusEl.classList.add('is-connected');
      statusEl.innerHTML = '<span class="status-dot"></span> Connected · just now';
      setCaption(`Context Manager connected to ${sourceLabels[key]}.`);
      await sleep(260, token);
    };
  }

  function stepAddFact(fact) {
    return async (token) => {
      setCaption('Extracting facts from connected sources…');
      const list = qs('#factsList');
      const el = document.createElement('div');
      el.className = 'fact-item';
      el.innerHTML = `${icon('<path d="M12 2a7 7 0 00-4 12.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/><path d="M9 21h6"/>', 'class="fact-icon"')}
        <div class="fact-text"><b>${fact.text}</b></div>
        <div class="fact-meta"><span class="confidence-pill">${fact.conf}%</span><span>${fact.source}</span></div>`;
      list.appendChild(el);
      await sleep(480, token);
    };
  }

  async function stepShowClarify(token) {
    setCaption('Context Manager needs a decision — multiple login flows found.');
    qs('#clarifyCard').classList.remove('hidden');
    await sleep(1100, token);
  }
  async function stepChooseMerge(token) {
    qs('#clarifyActions [data-choice="merge"]').classList.add('chip-active');
    setCaption('Merging duplicate flows into one canonical Authentication / Login flow…');
    await sleep(600, token);
  }
  async function stepClarifyResult(token) {
    const res = qs('#clarifyResult');
    res.innerHTML = `${icon('<path d="M20 6L9 17l-5-5"/>')} Merged into Authentication / Login — now Human Verified.`;
    res.classList.remove('hidden');
    setCaption('Flow ambiguity resolved. Fact promoted to Human Verified.');
    await sleep(1300, token);
  }

  const scene1Steps = [
    ...sourcesOrder.map(stepConnectSource),
    ...factsData.map(stepAddFact),
    stepShowClarify,
    stepChooseMerge,
    stepClarifyResult,
  ];

  // ======================================================================
  // SCENE 2 — Generate Coverage
  // ======================================================================
  const generatedTests = [
    { id: 'TC-2041', title: 'Declined card shows error banner', steps: 5 },
    { id: 'TC-2042', title: 'Expired card blocks checkout', steps: 4 },
    { id: 'TC-2043', title: 'Insufficient funds triggers retry prompt', steps: 6 },
    { id: 'TC-2044', title: 'Saved card auto-fills billing address', steps: 4 },
    { id: 'TC-2045', title: '3DS challenge completes payment', steps: 7 },
    { id: 'TC-2046', title: 'Guest checkout captures receipt email', steps: 5 },
  ];

  function resetScene2() {
    qsa('#coverageGrid .coverage-bar-fill').forEach((fill) => { fill.style.width = '0%'; });
    qsa('#coverageGrid [data-pct]').forEach((pct) => { pct.textContent = '0%'; });
    qs('#rowCheckoutPayment').classList.add('highlight');
    qs('#genPlan').classList.add('hidden');
    qs('#tcList').innerHTML = '';
    qs('#toastStack2').innerHTML = '';
    qs('#btnGenerateTests').disabled = false;
    qs('#btnGenerateTests').innerHTML = `${icon('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/>')} Generate tests`;
  }

  async function stepAnimateBars(token) {
    setCaption('Loading coverage analysis across product areas…');
    const rows = qsa('.coverage-row');
    const fills = rows.map((r) => qs('.coverage-bar-fill', r));
    const pcts = rows.map((r) => qs('[data-pct]', r));
    const targets = fills.map((f) => parseInt(f.dataset.target, 10));
    fills.forEach((f, i) => { f.style.width = targets[i] + '%'; });
    await countUp(pcts, targets, targets.map(() => '%'), 750);
    await sleep(300, token);
  }

  async function stepGeneratePlan(token) {
    setCaption('Generating a coverage plan for Checkout / Payment…');
    qs('#btnGenerateTests').disabled = true;
    await sleep(500, token);
    const plan = qs('#genPlan');
    plan.querySelector('.gen-plan-title').innerHTML = `${icon('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/>')} Generation plan — Checkout / Payment`;
    plan.classList.remove('hidden');
    await sleep(900, token);
  }

  function stepAddTestCase(tc) {
    return async (token) => {
      setCaption(`Generating ${tc.id} — ${tc.title}`);
      const list = qs('#tcList');
      const el = document.createElement('div');
      el.className = 'tc-row';
      el.innerHTML = `<span class="tc-id">${tc.id}</span><span class="tc-title">${tc.title}</span><span class="tc-steps">${tc.steps} steps</span><span class="ai-badge">${icon('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/>')} AI generated</span>`;
      list.appendChild(el);
      await sleep(340, token);
    };
  }

  async function stepApproveAll(token) {
    setCaption('Approving generated tests and merging into the library…');
    await sleep(500, token);
    showToast('toastStack2', '6 test cases merged. Automation coverage: 42% → 81%.');
    const row = qs('#rowCheckoutPayment');
    const fill = qs('.coverage-bar-fill', row);
    fill.style.width = '81%';
    await countUp([qs('[data-pct]', row)], [81], ['%'], 700);
    row.classList.remove('highlight');
    await sleep(1100, token);
  }

  const scene2Steps = [
    stepAnimateBars,
    stepGeneratePlan,
    ...generatedTests.map(stepAddTestCase),
    stepApproveAll,
  ];

  // ======================================================================
  // SCENE 3 — Execute
  // ======================================================================
  const testRows = [
    { id: 'TC-1001', name: 'Login with valid enterprise SSO user', flow: 'Authentication / Login', duration: '12s', owner: 'Ravi Patel', finalStatus: 'passed' },
    { id: 'TC-1015', name: 'Forgot password sends reset email', flow: 'Authentication / Forgot Password', duration: '9s', owner: 'Ravi Patel', finalStatus: 'passed' },
    { id: 'TC-1033', name: 'Add item updates cart total', flow: 'Checkout / Add Item', duration: '14s', owner: 'Elena Garcia', finalStatus: 'passed' },
    { id: 'TC-1042', name: 'Payment decline shows banner', flow: 'Checkout / Payment', duration: '48s', owner: 'Maya Chen', finalStatus: 'failed' },
    { id: 'TC-1128', name: 'Archived user cannot checkout', flow: 'Checkout / Confirmation', duration: '21s', owner: 'Maya Chen', finalStatus: 'passed' },
    { id: 'TC-1151', name: 'Declined card shows retry option', flow: 'Checkout / Payment', duration: '17s', owner: 'Maya Chen', finalStatus: 'passed' },
  ];

  function renderExecRow(row) {
    const el = document.createElement('div');
    el.className = 'exec-row';
    el.id = 'exec-row-' + row.id;
    el.innerHTML = `
      ${icon('<circle cx="12" cy="12" r="9"/>', 'class="row-icon"')}
      <div class="tname">${row.id} ${row.name}</div>
      <div class="tflow">${row.flow}</div>
      <span class="status-pill st-queued" data-status><span class="dot-solid"></span>Queued</span>
      <div class="tduration" data-duration>—</div>
      <div class="towner">${row.owner}</div>`;
    return el;
  }

  function resetScene3() {
    const table = qs('#execTable');
    table.innerHTML = '';
    testRows.forEach((row) => table.appendChild(renderExecRow(row)));
    qs('#kpiPassed').textContent = '0';
    qs('#kpiFailed').textContent = '0';
    qs('#kpiRunning').textContent = '0';
    qs('#kpiDuration').textContent = '0:00';
    qs('#kpiConfidence').textContent = '—';
    qs('#btnRunSuite').disabled = false;
    qs('#btnRunSuite').innerHTML = `${icon('<path d="M6 4l15 8-15 8V4z" fill="currentColor" stroke="none"/>')} Run Suite`;
  }

  async function stepClickRun(token) {
    qs('#btnRunSuite').disabled = true;
    setCaption('Executor agent starting Run #1 across Chrome, Firefox, WebKit…');
    await sleep(500, token);
  }

  function stepStartRow(row) {
    return async (token) => {
      const el = qs('#exec-row-' + row.id);
      const pill = qs('[data-status]', el);
      pill.className = 'status-pill st-running';
      pill.innerHTML = `<span class="dot-spin"></span>Running`;
      bumpKpi('kpiRunning', 1);
      setCaption(`Running ${row.id} — ${row.name}`);
      await sleep(380, token);
    };
  }

  function stepFinishRow(row) {
    return async (token) => {
      const el = qs('#exec-row-' + row.id);
      const pill = qs('[data-status]', el);
      bumpKpi('kpiRunning', -1);
      if (row.finalStatus === 'passed') {
        pill.className = 'status-pill st-passed';
        pill.innerHTML = `<span class="dot-solid"></span>Passed`;
        bumpKpi('kpiPassed', 1);
      } else {
        pill.className = 'status-pill st-failed';
        pill.innerHTML = `<span class="dot-solid"></span>Failed`;
        bumpKpi('kpiFailed', 1);
        el.classList.add('is-selected');
        setCaption(`${row.id} failed — payment decline banner did not render.`);
      }
      qs('[data-duration]', el).textContent = row.duration;
      await sleep(240, token);
    };
  }

  async function stepFinishSummary(token) {
    qs('#kpiDuration').textContent = '2:14';
    qs('#kpiConfidence').textContent = '91%';
    setCaption('Execution complete — 1 failure detected, flagged for investigation.');
    await sleep(1300, token);
  }

  const scene3Steps = [
    stepClickRun,
    ...testRows.flatMap((row) => [stepStartRow(row), stepFinishRow(row)]),
    stepFinishSummary,
  ];

  // ======================================================================
  // SCENE 4 — Investigate & Explain
  // ======================================================================
  const aiAnalysisText = 'The pay-now button’s test id changed during a recent redesign — the locator [data-testid="pay-now"] no longer matches anything on the page. The underlying accessible role and name (button, “Pay now”) are unchanged, so a role-based locator will be stable here. This exact pattern caused 2 other recent failures.';

  function resetScene4() {
    qs('#shell-4').classList.remove('inspector-open');
    const el = qs('#aiStreamText');
    el.textContent = '';
    el.classList.remove('done');
    qs('#evidenceStrip').classList.add('hidden');
    qs('#relatedList').classList.add('hidden');
    const btn = qs('#btnCreateHealing');
    btn.textContent = 'Create healing suggestion';
    btn.disabled = true;
  }

  async function stepOpenInspector(token) {
    qs('#shell-4').classList.add('inspector-open');
    setCaption('Opening AI Analysis for TC-1042…');
    await sleep(550, token);
  }

  async function stepStreamAnalysis(token) {
    const el = qs('#aiStreamText');
    el.textContent = '';
    const words = aiAnalysisText.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (token !== state.runToken) return;
      el.textContent += (i ? ' ' : '') + words[i];
      await sleep(26, token);
    }
    if (token !== state.runToken) return;
    el.classList.add('done');
    setCaption('Root cause identified — stale test-id locator.');
    await sleep(500, token);
  }

  async function stepShowEvidence(token) {
    qs('#evidenceStrip').classList.remove('hidden');
    await sleep(600, token);
  }
  async function stepShowRelated(token) {
    qs('#relatedList').classList.remove('hidden');
    setCaption('Found 3 similar failures in the last 30 days.');
    await sleep(900, token);
  }
  async function stepEnableHealing(token) {
    qs('#btnCreateHealing').disabled = false;
    await sleep(500, token);
  }
  async function stepClickCreateHealing(token) {
    const btn = qs('#btnCreateHealing');
    btn.innerHTML = `${icon('<path d="M20 6L9 17l-5-5"/>')} Healing suggestion created`;
    btn.disabled = true;
    setCaption('Healing suggestion created and routed to the Healer queue.');
    await sleep(1200, token);
  }

  const scene4Steps = [
    stepOpenInspector,
    stepStreamAnalysis,
    stepShowEvidence,
    stepShowRelated,
    stepEnableHealing,
    stepClickCreateHealing,
  ];

  // ======================================================================
  // SCENE 5 — Self-Heal
  // ======================================================================
  function resetScene5() {
    qs('#healRow').classList.add('hidden');
    qs('#confBanner').classList.add('hidden');
    qs('#diffViewer').classList.add('hidden');
    qs('#healActions').classList.add('hidden');
    qs('#healActions [data-choice="approve"]').classList.remove('chip-active');
    qs('#applyModal').classList.remove('show');
    qs('#optShared').classList.remove('chosen');
    qs('#optCurrent').classList.remove('chosen');
    qs('#toastStack5').innerHTML = '';
  }

  async function stepRevealHealRow(token) {
    qs('#healRow').classList.remove('hidden');
    setCaption('Healer agent proposes a resilient replacement locator — confidence 94%.');
    await sleep(700, token);
  }
  async function stepRevealDiagnosis(token) {
    qs('#confBanner').classList.remove('hidden');
    await sleep(500, token);
    if (token !== state.runToken) return;
    qs('#diffViewer').classList.remove('hidden');
    await sleep(900, token);
  }
  async function stepRevealActions(token) {
    qs('#healActions').classList.remove('hidden');
    await sleep(600, token);
  }
  async function stepApproveClick(token) {
    qs('#healActions [data-choice="approve"]').classList.add('chip-active');
    setCaption('Approving suggestion…');
    await sleep(500, token);
  }
  async function stepOpenApplyModal(token) {
    qs('#applyModal').classList.add('show');
    await sleep(700, token);
  }
  async function stepChooseShared(token) {
    qs('#optShared').classList.add('chosen');
    setCaption('Applying fix to the shared action library — protects 12 tests.');
    await sleep(900, token);
  }
  async function stepCloseModalAndPR(token) {
    qs('#applyModal').classList.remove('show');
    showToast('toastStack5', 'Pull request opened: fix(locator): heal pay-now button selector');
    setCaption('Pull request opened and assigned for review.');
    await sleep(1400, token);
  }

  const scene5Steps = [
    stepRevealHealRow,
    stepRevealDiagnosis,
    stepRevealActions,
    stepApproveClick,
    stepOpenApplyModal,
    stepChooseShared,
    stepCloseModalAndPR,
  ];

  // ======================================================================
  // SCENE 6 — Ship It / Recap
  // ======================================================================
  function resetScene6() {
    qs('#prChecksLabel').textContent = '3 checks pending';
    const pill = qs('#prStatusPill');
    pill.textContent = 'Open';
    pill.style.background = '';
    pill.style.color = '';
    qs('#prCard').style.borderColor = '';
    qsa('.recap-value').forEach((c) => { c.textContent = '0' + (c.dataset.suffix || ''); });
    qsa('#recapList li').forEach((li) => li.classList.remove('show'));
  }

  async function stepChecksRunning(token) {
    const label = qs('#prChecksLabel');
    const seq = ['3 checks pending', '2 of 3 checks passed', 'All checks passed'];
    for (const s of seq) {
      if (token !== state.runToken) return;
      label.textContent = s;
      await sleep(480, token);
    }
  }
  async function stepMergePR(token) {
    const pill = qs('#prStatusPill');
    pill.textContent = 'Merged';
    qs('#prCard').style.borderColor = 'color-mix(in srgb, var(--success) 45%, transparent)';
    setCaption('Healing PR merged automatically — tests are green again.');
    await sleep(900, token);
  }
  async function stepRecapCounts(token) {
    const cards = qsa('.recap-value');
    const targets = cards.map((c) => parseInt(c.dataset.count, 10));
    const suffixes = cards.map((c) => c.dataset.suffix || '');
    await countUp(cards, targets, suffixes, 900);
    setCaption('Dashboard updated in real time.');
    await sleep(500, token);
  }
  function stepShowRecapItem(i) {
    return async (token) => {
      qsa('#recapList li')[i].classList.add('show');
      await sleep(320, token);
    };
  }
  async function stepTourComplete(token) {
    setCaption('Tour complete — restart to watch again, or jump to any chapter below.');
  }

  const scene6Steps = [
    stepChecksRunning,
    stepMergePR,
    stepRecapCounts,
    ...[0, 1, 2, 3, 4].map(stepShowRecapItem),
    stepTourComplete,
  ];

  // ---------- scene registry ----------
  const sceneScripts = { 1: scene1Steps, 2: scene2Steps, 3: scene3Steps, 4: scene4Steps, 5: scene5Steps, 6: scene6Steps };
  const resetters = { 1: resetScene1, 2: resetScene2, 3: resetScene3, 4: resetScene4, 5: resetScene5, 6: resetScene6 };

  async function runSteps(token, steps) {
    for (const step of steps) {
      if (token !== state.runToken) return false;
      await step(token);
      if (token !== state.runToken) return false;
    }
    return true;
  }

  async function playScene(index) {
    state.runToken += 1;
    const token = state.runToken;
    showScene(index);
    if (resetters[index]) resetters[index]();
    if (index >= 1 && index <= 6) updateChapterUI(index);
    const steps = sceneScripts[index];
    if (!steps) return;
    const completed = await runSteps(token, steps);
    if (!completed) return;
    finishProgressFor(index);
    if (state.autoAdvance && index < 6) {
      await sleep(1500, token);
      if (token !== state.runToken) return;
      playScene(index + 1);
    }
  }

  function goToScene(index) {
    playScene(index);
  }

  function restartTour() {
    state.runToken += 1;
    state.paused = false;
    state.autoAdvance = true;
    updatePlayIcon();
    showScene(0);
    Object.values(resetters).forEach((fn) => fn());
    qsa('.chapter-btn').forEach((b) => b.classList.remove('is-active', 'is-done'));
    qs('#progressFill').style.width = '0%';
    setCaption('Press play to start the guided tour.');
  }

  function updatePlayIcon() {
    qs('#btnPlay').innerHTML = state.paused ? ICONS.play : ICONS.pause;
  }

  function togglePlayPause() {
    if (state.currentScene === 0) {
      state.autoAdvance = true;
      playScene(1);
      state.paused = false;
      updatePlayIcon();
      return;
    }
    state.paused = !state.paused;
    updatePlayIcon();
  }

  // ---------- contact modal ----------
  function initContactModal() {
    const backdrop = qs('#contactModal');
    const card = qs('#contactModalCard');
    const originalHTML = card.innerHTML;

    function open() { backdrop.classList.remove('hidden'); }
    function close() {
      backdrop.classList.add('hidden');
      card.innerHTML = originalHTML;
      wireForm();
    }

    function wireForm() {
      qs('#btnCloseModal', card).addEventListener('click', close);
      qs('#contactForm', card).addEventListener('submit', (e) => {
        e.preventDefault();
        card.innerHTML = `
          <div class="modal-success">
            <div class="icon-ok">${icon('<path d="M20 6L9 17l-5-5"/>')}</div>
            <h3>Thanks — we'll be in touch</h3>
            <p>This is a scripted demo, so nothing was actually sent. In the real product, your team would hear back from us within one business day.</p>
            <div class="modal-actions" style="justify-content:center;margin-top:16px;">
              <button class="btn-secondary" id="btnDone">Close</button>
            </div>
          </div>`;
        qs('#btnDone', card).addEventListener('click', close);
      });
    }

    wireForm();
    qs('#btnContact').addEventListener('click', open);
    qs('#btnContact2').addEventListener('click', open);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  }

  // ---------- init ----------
  function init() {
    renderChapters();

    qs('#btnPlay').innerHTML = ICONS.pause;
    qs('#btnRestart').innerHTML = ICONS.restart;
    qs('#btnContact').innerHTML = `${ICONS.calendar} <span class="btn-label">Book a working session</span>`;
    qs('#btnContact2').innerHTML = `${ICONS.calendar} Book a working session`;
    qs('#btnRestart2').innerHTML = `${ICONS.restart} Restart tour`;
    qs('.hero-eyebrow').innerHTML = `${ICONS.sparkles} Scripted product walkthrough`;
    qs('#btnPlayTour').innerHTML = `${ICONS.rocket} Play the full tour (3 min)`;
    qs('#btnGenerateTests').innerHTML = `${ICONS.sparkles} Generate tests`;
    qs('#btnRunSuite').innerHTML = `${icon('<path d="M6 4l15 8-15 8V4z" fill="currentColor" stroke="none"/>')} Run Suite`;

    qs('#btnPlay').addEventListener('click', togglePlayPause);
    qs('#btnRestart').addEventListener('click', restartTour);
    qs('#btnRestart2').addEventListener('click', restartTour);

    qs('#btnPlayTour').addEventListener('click', () => {
      state.autoAdvance = true;
      state.paused = false;
      updatePlayIcon();
      playScene(1);
    });
    qs('#btnJumpChapters').addEventListener('click', () => {
      state.autoAdvance = false;
      state.paused = false;
      updatePlayIcon();
      playScene(1);
    });

    qs('#btnGenerateTests').addEventListener('click', () => {}); // visual only; driven by script
    qs('#btnRunSuite').addEventListener('click', () => {}); // visual only; driven by script

    initContactModal();

    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
      if (e.key === 'ArrowRight') { const n = Math.min(6, (state.currentScene || 0) + 1) || 1; goToScene(n); }
      if (e.key === 'ArrowLeft') { const p = Math.max(1, (state.currentScene || 1) - 1); goToScene(p); }
    });

    setCaption('Press play to start the guided tour.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
