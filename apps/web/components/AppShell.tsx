'use client';
import { useMemo, useState } from 'react';
import type { InspectorSelection, PageKey, WorkspaceSeed } from '../lib/types';
import { ActionsScreen, ContextScreen, CoverageScreen, DashboardScreen, DataSetupScreen, DomScreen, ExecutionsScreen, FactsScreen, FlowsScreen, HealerScreen, PullRequestsScreen, RunScreen, SettingsScreen, TestCasesScreen } from './screens';
import { keyboardShortcuts } from '../lib/ui-catalog';

const pageTitles: Record<PageKey,string> = { dashboard:'Quality Command Center', executions:'Executions', run:'Execution #14 / Run #1', healer:'Healer', context:'Context Manager', flows:'Flows', facts:'Fact Database', actions:'Action Library', dom:'DOM Snapshots', data:'Data Setup', testcases:'Test Cases', coverage:'Coverage Analysis', prs:'AI Pull Requests', settings:'Settings & Integrations' };
const nav = [
  { label:'Dashboard', id:'dashboard' },
  { label:'Agents', children:[
    { label:'Executor', id:'executions', children:['Executions','Execution #14','Run #1','Test Cases','Logs','Timeline','AI Reasoning','Screenshots','Videos','Network','Console','Performance'].map((label,i)=>({ label, id:i>0&&i<3?'run':'executions' })) },
    { label:'Healer', id:'healer', children:['Healing Queue','Suggestions','Approved','Rejected','Learning'].map(label=>({ label, id:'healer' })) },
    { label:'Context Manager', id:'context', children:['Sources','Clarifications','Requests','Fact Builder','Embeddings','Relationships'].map(label=>({ label, id:'context' })) },
    { label:'Test Case Manager', id:'testcases', children:['Test Cases','Coverage Analysis','PRs','Reviews','Suggestions'].map(label=>({ label, id:label==='Coverage Analysis'?'coverage':'testcases' })) }
  ]},
  { label:'Context', id:'context' }, { label:'Flows', id:'flows' }, { label:'Facts', id:'facts' }, { label:'Actions', id:'actions' }, { label:'DOM', id:'dom' }, { label:'Data Setup', id:'data' }, { label:'Test Cases', id:'testcases' }, { label:'Settings', id:'settings' }
] as const;

export function AppShell({ initialWorkspace }: { initialWorkspace: WorkspaceSeed }) {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [theme, setTheme] = useState<'dark'|'light'>('dark');
  const [commandOpen, setCommandOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [toast, setToast] = useState('Ready: all agents connected');
  const [inspectorTab, setInspectorTab] = useState('Overview');
  const [selected, setSelected] = useState<InspectorSelection>({ type:'Test Case', title:'TC-1042 Payment decline shows banner', status:'Failed', confidence:'87%' });
  const screenProps = useMemo(() => ({ data: initialWorkspace, setPage, setSelected, setModal, setToast }), [initialWorkspace]);
  return <div className={`app-shell ${theme}`} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') setCommandOpen(true); }}>
    <header className="topbar">
      <div className="crumb">Workspace / {pageTitles[page]}</div>
      <button className="global-search" onClick={() => setCommandOpen(true)}>Search everything <kbd>Ctrl K</kbd></button>
      <button className="btn primary" onClick={() => { setModal('Run Suite'); setToast('Run configuration opened'); }}>Run</button><button className="btn" onClick={() => setNotificationsOpen(!notificationsOpen)}>Notifications</button><button className="btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button><div className="avatar">MC</div>
    </header>
    <div className="workspace">
      <aside className="left-sidebar"><div className="brand">✦ QA Master Agent</div><NavTree items={nav} onNavigate={setPage}/><AgentPresence/></aside>
      <main className="main-panel"><PageHeader title={pageTitles[page]} page={page}/>{renderScreen(page, screenProps)}</main>
      <RightInspector selected={selected} activeTab={inspectorTab} setActiveTab={setInspectorTab}/>
    </div>
    <AICopilot open={copilotOpen} setOpen={setCopilotOpen} selected={selected}/><NotificationCenter open={notificationsOpen}/>{toast && <Toast message={toast} onClose={() => setToast('')}/>} {modal && <ActionModal title={modal} onClose={() => setModal(null)} onDone={() => { setToast(`${modal} completed`); setModal(null); }}/>} {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={setPage} setModal={setModal}/>}  
  </div>;
}
function renderScreen(page: PageKey, props: { data: WorkspaceSeed; setPage: (page:PageKey)=>void; setSelected:(selection:InspectorSelection)=>void; setModal:(name:string)=>void; setToast:(message:string)=>void }) {
  const screens = { dashboard:DashboardScreen, executions:ExecutionsScreen, run:RunScreen, healer:HealerScreen, context:ContextScreen, flows:FlowsScreen, facts:FactsScreen, actions:ActionsScreen, dom:DomScreen, data:DataSetupScreen, testcases:TestCasesScreen, coverage:CoverageScreen, prs:PullRequestsScreen, settings:SettingsScreen };
  const Screen = screens[page]; return <Screen {...props}/>;
}
function NavTree({ items, onNavigate, level = 0 }: { items: readonly any[]; onNavigate:(page:PageKey)=>void; level?:number }) { return <div>{items.map((item, index) => <div key={`${item.label}-${index}`}><button className="tree-item" style={{ paddingLeft: 10 + level * 16 }} onClick={() => item.id && onNavigate(item.id)}><span>{item.children ? '⌄' : '›'}</span><span>{iconFor(item.label)}</span>{item.label}</button>{item.children && <NavTree items={item.children} onNavigate={onNavigate} level={level + 1}/>}</div>)}</div>; }
function iconFor(label:string){ return ({ Dashboard:'▦', Agents:'◉', Context:'◎', Flows:'⑂', Facts:'▤', Actions:'{}', DOM:'⌘', 'Data Setup':'◈', 'Test Cases':'☑', Settings:'⚙' } as Record<string,string>)[label] ?? '•'; }
function PageHeader({ title, page }: { title:string; page:PageKey }) { return <section className="page-header"><div><p className="eyebrow">AI-native QA automation platform</p><h1>{title}</h1></div><div className="actions"><button className="btn">Filter</button><button className="btn">Saved Views</button><button className="btn">Export</button><button className="btn primary">{page === 'healer' ? 'Approve Selected' : 'Generate'}</button></div></section>; }
function RightInspector({ selected, activeTab, setActiveTab }: { selected: InspectorSelection; activeTab:string; setActiveTab:(tab:string)=>void }) { const tabs=['Overview','Execution History','Logs','AI Analysis','DOM Snapshot','Screenshots','Network','Video','Console','Stacktrace','Suggested Fixes','Facts','Coverage','Dependencies','Comments','Version History','JSON']; return <aside className="right-inspector"><div className="inspect-head"><div><p className="eyebrow">{selected.type}</p><h2>{selected.title}</h2></div><span>◧</span></div><div className="tabs">{tabs.map(tab => <button className={activeTab===tab?'active':''} key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div><div className="inspect-body"><div className={`status ${selected.status === 'Failed' ? 'bad' : selected.status === 'Warning' ? 'warn' : 'good'}`}>{selected.status}</div><p>Confidence: <b>{selected.confidence}</b></p><section className="card"><h3>{activeTab}</h3><p>{activeTab === 'AI Analysis' ? 'AI found a likely product behavior change and recommends a resilient locator plus assertion update.' : `Contextual ${activeTab.toLowerCase()} details for ${selected.type}.`}</p></section><ul className="mini"><li>Copy link</li><li>Create Jira bug</li><li>Open GitHub PR</li><li>Archive</li><li>Add comment</li></ul><section className="card"><h3>Suggested Fix</h3><p>Use accessible role selectors, update related action library, and open an AI PR for review.</p><button className="btn primary">Open PR</button></section></div></aside>; }
function AgentPresence(){ return <div className="pulse"><b>Agents online</b><span>⚡ Executor streaming</span><span>🛡 Healer learning</span><span>◈ Context synced</span></div>; }
function AICopilot({ open, setOpen, selected }: { open:boolean; setOpen:(open:boolean)=>void; selected:InspectorSelection }){ return <>{open && <aside className="copilot-panel"><button onClick={() => setOpen(false)}>×</button><h2>AI Copilot</h2><p>Grounded on: <b>{selected.title}</b></p><div className="chat"><p>Ask: What failed yesterday? Generate checkout tests. Find flaky tests. Explain this failure. Why did healing occur?</p><textarea placeholder="Ask the QA agent..."/><button className="btn primary">Send</button></div></aside>}<button className="ai-copilot" onClick={() => setOpen(!open)}>✦ Ask AI</button></>; }
function NotificationCenter({ open }: { open:boolean }){ return <>{open && <aside className="notifications-drawer"><h2>Notifications</h2><ul className="mini"><li>Execution completed</li><li>Healing suggestion awaiting review</li><li>PR awaiting review</li><li>Context updated</li><li>Coverage decreased</li><li>Integration disconnected</li></ul></aside>}<div className="notification-center">🐞 Healing suggestion awaiting review</div></>; }
function Toast({ message, onClose }: { message:string; onClose:()=>void }) { return <button className="toast" onClick={onClose}>{message} · Undo</button>; }
function ActionModal({ title, onClose, onDone }: { title:string; onClose:()=>void; onDone:()=>void }) { return <div className="modal-backdrop"><div className="modal"><button onClick={onClose}>×</button><h2>{title}</h2><p>Configure environment, browser, tags, retry policy, execution engine, and artifact collection.</p><div className="form-grid"><input placeholder="Environment: staging"/><input placeholder="Browser: Chrome"/><input placeholder="Tags: smoke, checkout"/><select><option>Playwright</option><option>Cypress</option><option>Selenium</option></select></div><button className="btn primary" onClick={onDone}>Confirm</button></div></div>; }
function CommandPalette({ onClose, onNavigate, setModal }: { onClose:()=>void; onNavigate:(page:PageKey)=>void; setModal:(name:string)=>void }) { return <div className="command-palette"><div><button onClick={onClose}>×</button><h2>Search everything</h2><input autoFocus placeholder="Test cases, executions, pages, flows, facts, actions, DOM, agents, users..."/><div className="command-grid">{(['dashboard','executions','healer','context','testcases','coverage','prs','settings'] as PageKey[]).map(page => <button key={page} onClick={() => { onNavigate(page); onClose(); }}>{pageTitles[page]}</button>)}{['Run suite','Rerun failed','Generate checkout tests','Create missing test cases','Open keyboard shortcuts'].map(command => <button key={command} onClick={() => { setModal(command); onClose(); }}>{command}</button>)}</div><h3>Keyboard shortcuts</h3><div className="shortcut-grid">{keyboardShortcuts.map(([keys,action]) => <span key={keys}><kbd>{keys}</kbd>{action}</span>)}</div></div></div>; }
