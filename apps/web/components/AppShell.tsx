'use client';
import { useMemo, useState } from 'react';
import type { InspectorSelection, PageKey, WorkspaceSeed } from '../lib/types';
import { ActionsScreen, ContextScreen, CoverageScreen, DashboardScreen, DataSetupScreen, DomScreen, ExecutionsScreen, FactsScreen, FlowsScreen, HealerScreen, PullRequestsScreen, RunScreen, SettingsScreen, TestCasesScreen } from './screens';

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
  const [selected, setSelected] = useState<InspectorSelection>({ type:'Test Case', title:'TC-1042 Payment decline shows banner', status:'Failed', confidence:'87%' });
  const screenProps = useMemo(() => ({ data: initialWorkspace, setPage, setSelected }), [initialWorkspace]);
  return <div className={`app-shell ${theme}`} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') setCommandOpen(true); }}>
    <header className="topbar">
      <div className="crumb">Workspace / {pageTitles[page]}</div>
      <button className="global-search" onClick={() => setCommandOpen(true)}>Search everything <kbd>Ctrl K</kbd></button>
      <button className="btn primary">Run</button><button className="btn">Notifications</button><button className="btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button><div className="avatar">MC</div>
    </header>
    <div className="workspace">
      <aside className="left-sidebar"><div className="brand">✦ QA Master Agent</div><NavTree items={nav} onNavigate={setPage}/><AgentPresence/></aside>
      <main className="main-panel"><PageHeader title={pageTitles[page]} page={page}/>{renderScreen(page, screenProps)}</main>
      <RightInspector selected={selected}/>
    </div>
    <AICopilot/><NotificationCenter/>{commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={setPage}/>}  
  </div>;
}
function renderScreen(page: PageKey, props: { data: WorkspaceSeed; setPage: (page:PageKey)=>void; setSelected:(selection:InspectorSelection)=>void }) {
  const screens = { dashboard:DashboardScreen, executions:ExecutionsScreen, run:RunScreen, healer:HealerScreen, context:ContextScreen, flows:FlowsScreen, facts:FactsScreen, actions:ActionsScreen, dom:DomScreen, data:DataSetupScreen, testcases:TestCasesScreen, coverage:CoverageScreen, prs:PullRequestsScreen, settings:SettingsScreen };
  const Screen = screens[page]; return <Screen {...props}/>;
}
function NavTree({ items, onNavigate, level = 0 }: { items: readonly any[]; onNavigate:(page:PageKey)=>void; level?:number }) { return <div>{items.map((item, index) => <div key={`${item.label}-${index}`}><button className="tree-item" style={{ paddingLeft: 10 + level * 16 }} onClick={() => item.id && onNavigate(item.id)}><span>{item.children ? '⌄' : '›'}</span><span>{iconFor(item.label)}</span>{item.label}</button>{item.children && <NavTree items={item.children} onNavigate={onNavigate} level={level + 1}/>}</div>)}</div>; }
function iconFor(label:string){ return ({ Dashboard:'▦', Agents:'◉', Context:'◎', Flows:'⑂', Facts:'▤', Actions:'{}', DOM:'⌘', 'Data Setup':'◈', 'Test Cases':'☑', Settings:'⚙' } as Record<string,string>)[label] ?? '•'; }
function PageHeader({ title, page }: { title:string; page:PageKey }) { return <section className="page-header"><div><p className="eyebrow">AI-native QA automation platform</p><h1>{title}</h1></div><div className="actions"><button className="btn">Filter</button><button className="btn">Sync</button><button className="btn primary">{page === 'healer' ? 'Approve Selected' : 'Generate'}</button></div></section>; }
function RightInspector({ selected }: { selected: InspectorSelection }) { return <aside className="right-inspector"><div className="inspect-head"><div><p className="eyebrow">{selected.type}</p><h2>{selected.title}</h2></div><span>◧</span></div><div className="tabs"><button>Overview</button><button>Evidence</button><button>AI Analysis</button><button>Activity</button></div><div className="inspect-body"><div className={`status ${selected.status === 'Failed' ? 'bad' : selected.status === 'Warning' ? 'warn' : 'good'}`}>{selected.status}</div><p>Confidence: <b>{selected.confidence}</b></p><ul className="mini"><li>Execution History</li><li>Logs</li><li>DOM Snapshot</li><li>Screenshots</li><li>Network</li><li>Console</li><li>Stacktrace</li><li>Suggested Fixes</li></ul><section className="card"><h3>Suggested Fix</h3><p>Use accessible role selectors, update related action library, and open an AI PR for review.</p><button className="btn primary">Open PR</button></section></div></aside>; }
function AgentPresence(){ return <div className="pulse"><b>Agents online</b><span>⚡ Executor streaming</span><span>🛡 Healer learning</span><span>◈ Context synced</span></div>; }
function AICopilot(){ return <button className="ai-copilot">✦ Ask AI</button>; }
function NotificationCenter(){ return <div className="notification-center">🐞 Healing suggestion awaiting review</div>; }
function CommandPalette({ onClose, onNavigate }: { onClose:()=>void; onNavigate:(page:PageKey)=>void }) { return <div className="command-palette"><div><button onClick={onClose}>×</button><h2>Search everything</h2><input autoFocus placeholder="Test cases, executions, pages, flows, facts, actions, DOM, agents, users..."/><div className="command-grid">{(['dashboard','executions','healer','context','testcases','coverage'] as PageKey[]).map(page => <button key={page} onClick={() => { onNavigate(page); onClose(); }}>{pageTitles[page]}</button>)}</div><p>Try: Explain this failure · Generate checkout tests · Find flaky tests</p></div></div>; }
