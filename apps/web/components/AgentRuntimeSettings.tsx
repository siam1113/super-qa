'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, RotateCcw, Sparkles, Wrench } from 'lucide-react';
import { AgentModelSelection, AgentRuntimeSettings as RuntimeSettings, chatRequest } from '@/lib/chat';
import { cn } from '@/lib/utils';

export function AgentRuntimeSettings({ agentId, section, canEdit, onSectionChange }: {
  agentId?: string;
  section: 'skills' | 'tools' | 'model' | 'budget';
  canEdit: boolean;
  onSectionChange: (section: 'skills' | 'tools' | 'model' | 'budget') => void;
}) {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [choice, setChoice] = useState('');
  const [budget, setBudget] = useState('');
  const [temperature, setTemperature] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [savingTemperature, setSavingTemperature] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focusedSkill, setFocusedSkill] = useState<string | null>(null);
  const skillRef = useRef<HTMLElement | null>(null);
  const [focusedTool, setFocusedTool] = useState<string | null>(null);
  const toolRef = useRef<HTMLElement | null>(null);
  const encode = (selection: AgentModelSelection | null) => selection ? JSON.stringify([selection.provider, selection.model]) : '';

  useEffect(() => {
    setSettings(null); setError(''); setNotice(''); setLoading(true);
    setFocusedSkill(null); setFocusedTool(null);
    if (!agentId) { setLoading(false); return; }
    const controller = new AbortController();
    chatRequest<RuntimeSettings>(`/agents/${agentId}/settings`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setSettings(value); setChoice(encode(value.modelSelection)); setBudget(value.maxIterations === null ? '' : String(value.maxIterations)); setTemperature(value.temperature === null ? '' : String(value.temperature)); } })
      .catch(failure => { if (!controller.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [agentId, revision]);

  useEffect(() => {
    const target = section === 'skills' && focusedSkill ? skillRef.current : section === 'tools' && focusedTool ? toolRef.current : null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [section, focusedSkill, focusedTool, settings]);

  useEffect(() => { setError(''); setNotice(''); }, [section]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!agentId || !settings || !canEdit) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const [provider, model] = choice ? JSON.parse(choice) : ['default', ''];
      const saved = await chatRequest<{ modelSelection: AgentModelSelection | null }>(`/agents/${agentId}/model`, { provider, model });
      setSettings(previous => previous && ({ ...previous, modelSelection: saved.modelSelection, effectiveModel: saved.modelSelection || previous.defaultModel }));
      setChoice(encode(saved.modelSelection));
      setNotice('Model saved. Your next message will use this selection.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  }

  async function saveBudget(event: React.FormEvent) {
    event.preventDefault();
    if (!agentId || !settings || !canEdit) return;
    setSavingBudget(true); setError(''); setNotice('');
    try {
      const maxIterations = budget.trim() === '' ? null : Number(budget);
      const saved = await chatRequest<{ maxIterations: number | null }>(`/agents/${agentId}/limits`, { maxIterations });
      setSettings(previous => previous && ({ ...previous, maxIterations: saved.maxIterations, effectiveMaxIterations: saved.maxIterations ?? previous.defaultMaxIterations }));
      setBudget(saved.maxIterations === null ? '' : String(saved.maxIterations));
      setNotice('Reasoning budget saved. Your next message will use this limit.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSavingBudget(false); }
  }

  async function saveTemperature(event: React.FormEvent) {
    event.preventDefault();
    if (!agentId || !settings || !canEdit) return;
    setSavingTemperature(true); setError(''); setNotice('');
    try {
      const value = temperature.trim() === '' ? null : Number(temperature);
      const saved = await chatRequest<{ temperature: number | null }>(`/agents/${agentId}/temperature`, { temperature: value });
      setSettings(previous => previous && ({ ...previous, temperature: saved.temperature, effectiveTemperature: saved.temperature ?? previous.defaultTemperature }));
      setTemperature(saved.temperature === null ? '' : String(saved.temperature));
      setNotice('Temperature saved. Your next message will use this setting.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setSavingTemperature(false); }
  }

  if (!agentId) return <p className="text-sm text-text-secondary">Select a workspace agent to view its settings.</p>;
  if (loading) return <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />Loading agent settings…</p>;
  if (!settings) return <div className="space-y-3"><p role="alert" className="text-sm text-danger">{error || 'Agent settings are unavailable.'}</p><button type="button" onClick={() => setRevision(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-elevated"><RotateCcw size={14} />Try again</button></div>;

  const linkClass = 'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-xs text-accent-blue hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue';
  const cardClass = 'flex scroll-m-4 gap-3 p-4 focus:bg-accent-blue/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent-blue';

  if (section === 'skills') {
    return <div className="max-w-2xl">
      <div className="flex items-center gap-2"><h4 className="font-medium">Agent skills</h4><span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-secondary">{settings.skills.length}</span></div>
      <p className="mt-1 text-sm leading-6 text-text-secondary">QA workflows connected to this agent. Each skill coordinates tools to complete a task. Tools can be shared across skills.</p>
      {settings.skills.length ? <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{settings.skills.map(item => <article key={item.name} ref={focusedSkill === item.name ? skillRef : undefined} tabIndex={-1} aria-label={`${item.name} skill`} className={cardClass}>
        <Sparkles size={17} className="mt-1 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h5 className="break-words font-mono text-sm font-medium">{item.name}</h5><span className="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-text-secondary">Workflow</span></div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{item.description}</p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">Tools used · {item.toolNames.length}</p>
            <div className="mt-2 flex flex-wrap gap-2">{item.toolNames.map(name => <button type="button" key={name} onClick={() => { setFocusedTool(name); onSectionChange('tools'); }} aria-label={`View ${name} in Tools`} className={linkClass}>{name}<ArrowRight size={12} /></button>)}</div>
          </div>
        </div>
      </article>)}</div> : <p className="mt-5 rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">No skill workflows are connected to this agent.</p>}
    </div>;
  }

  if (section === 'tools') {
    const groups = [
      { id: 'workflow', title: 'Tools used by skills', description: 'Operations called inside workflows. The steps and inputs determine which tools run.', tools: settings.tools.filter(tool => tool.access === 'workflow') },
      { id: 'agent', title: 'Direct agent tools', description: 'Calls available directly to the agent, including skill discovery and execution.', tools: settings.tools.filter(tool => tool.access === 'agent') },
    ];
    return <div className="max-w-2xl space-y-6">
      <div><div className="flex items-center gap-2"><h4 className="font-medium">Available tools</h4><span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-secondary">{settings.tools.length}</span></div><p className="mt-1 text-sm leading-6 text-text-secondary">Each tool appears once. Skill links show where it is used. Some operations require configured resources or execution access.</p></div>
      {groups.filter(group => group.tools.length).map(group => <section key={group.id} aria-label={group.title}>
        <div className="flex items-center gap-2"><h5 className="text-sm font-medium">{group.title}</h5><span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-secondary">{group.tools.length}</span></div>
        <p className="mt-1 text-sm text-text-secondary">{group.description}</p>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">{group.tools.map(tool => <article key={tool.name} ref={focusedTool === tool.name ? toolRef : undefined} tabIndex={-1} aria-label={`${tool.name} tool`} className={cardClass}>
          <Wrench size={17} className="mt-1 shrink-0 text-text-secondary" />
          <div className="min-w-0 flex-1"><h6 className="break-words font-mono text-sm font-medium">{tool.name}</h6>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{tool.description}</p>
            {!!tool.usedBy.length && <div className="mt-3 border-t border-border pt-3"><p className="text-xs font-medium text-text-secondary">Used by</p><div className="mt-2 flex flex-wrap gap-2">{tool.usedBy.map(name => <button type="button" key={name} onClick={() => { setFocusedSkill(name); onSectionChange('skills'); }} aria-label={`View ${name} in Skills`} className={linkClass}>{name}<ArrowRight size={12} /></button>)}</div></div>}
          </div>
        </article>)}</div>
      </section>)}
      {!settings.tools.length && <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-secondary">No tools are registered for this agent.</p>}
    </div>;
  }

  if (section === 'model') {
    const options = settings.providers.flatMap(provider => provider.models.map(model => ({ provider: provider.id, model })));
    const savedUnavailable = settings.modelSelection && !options.some(option => encode(option) === encode(settings.modelSelection));
    return <div className="max-w-xl">
      <form onSubmit={save} className="space-y-5">
        <div><h4 className="font-medium">Agent model</h4><p className="mt-1 text-sm leading-6 text-text-secondary">Choose a model for this agent. Options come from your configured providers.</p></div>
        <label className="block text-sm font-medium">Model
          <select value={choice} onChange={event => { setChoice(event.target.value); setNotice(''); }} disabled={!canEdit || saving} className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-60">
            <option value="">Workspace default · {settings.defaultModel.provider} / {settings.defaultModel.model}</option>
            {savedUnavailable && <option value={encode(settings.modelSelection)} disabled>{settings.modelSelection!.provider} / {settings.modelSelection!.model} · currently unavailable</option>}
            {settings.providers.filter(provider => provider.models.length).map(provider => <optgroup key={provider.id} label={provider.id === 'openai' ? 'OpenAI' : provider.id === 'anthropic' ? 'Anthropic' : 'Ollama'}>{provider.models.map(model => <option key={model} value={encode({ provider: provider.id, model })}>{model}</option>)}</optgroup>)}
          </select>
        </label>
        <p className="text-xs text-text-secondary">Current selection: {settings.effectiveModel.provider} / {settings.effectiveModel.model}</p>
        {!options.length && <p className="text-sm text-text-secondary">No models could be loaded. Check provider configuration and refresh.</p>}
        {settings.providers.filter(provider => provider.error).map(provider => <p key={provider.id} className="text-xs text-text-secondary">{provider.id}: {provider.error}</p>)}
        <div className="flex items-center gap-3"><button type="submit" disabled={!canEdit || saving || choice === encode(settings.modelSelection)} className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save model'}</button><button type="button" disabled={saving} onClick={() => setRevision(value => value + 1)} className="rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-elevated disabled:opacity-40">Refresh models</button></div>
        {!canEdit && <p className="text-xs text-text-secondary">Only a workspace owner can change the agent model.</p>}
      </form>
      {error && <p role="alert" className="mt-5 text-sm text-danger">{error}</p>}{notice && <p role="status" className="mt-5 text-sm text-success">{notice}</p>}
    </div>;
  }

  const budgetUnchanged = budget.trim() === '' ? settings.maxIterations === null : Number(budget) === settings.maxIterations;
  const budgetInvalid = budget.trim() !== '' && (!Number.isInteger(Number(budget)) || Number(budget) < settings.minMaxIterations || Number(budget) > settings.maxMaxIterations);
  const budgetRange = settings.maxMaxIterations - settings.minMaxIterations;
  const currentValue = budget.trim() === '' ? settings.defaultMaxIterations : Number(budget);
  const meterPercent = budgetInvalid || !budgetRange ? null : Math.max(0, Math.min(100, ((currentValue - settings.minMaxIterations) / budgetRange) * 100));
  const presets = Array.from(new Set([settings.minMaxIterations, settings.defaultMaxIterations, settings.maxMaxIterations]));

  const temperatureUnchanged = temperature.trim() === '' ? settings.temperature === null : Number(temperature) === settings.temperature;
  const temperatureInvalid = temperature.trim() !== '' && (!Number.isFinite(Number(temperature)) || Number(temperature) < settings.minTemperature || Number(temperature) > settings.maxTemperature);
  const temperatureRange = settings.maxTemperature - settings.minTemperature;
  const currentTemperature = temperature.trim() === '' ? settings.defaultTemperature : Number(temperature);
  const temperatureMeterPercent = temperatureInvalid || !temperatureRange ? null : Math.max(0, Math.min(100, ((currentTemperature - settings.minTemperature) / temperatureRange) * 100));
  const temperaturePresets = Array.from(new Set([settings.minTemperature, settings.defaultTemperature, settings.maxTemperature]));

  return <div className="max-w-xl space-y-8">
    <form onSubmit={saveBudget} className="space-y-5">
      <div><h4 className="font-medium">Reasoning budget</h4><p className="mt-1 text-sm leading-6 text-text-secondary">How many model/tool-call rounds this agent may use to answer one message. A turn that needs more stops with "reached its reasoning budget" instead of looping indefinitely; raise this for tasks that chain several tool calls (e.g. explore a site, then draft cases from it).</p></div>
      <div className="rounded-xl border border-border bg-canvas p-4">
        <label className="block text-sm font-medium">Max calls per turn
          <input type="number" min={settings.minMaxIterations} max={settings.maxMaxIterations} step={1} value={budget}
                 onChange={event => { setBudget(event.target.value); setNotice(''); }} disabled={!canEdit || savingBudget}
                 placeholder={`Workspace default · ${settings.defaultMaxIterations}`}
                 className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm font-medium tabular-nums text-text-primary outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-60" />
        </label>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div className={cn('h-full rounded-full transition-[width] duration-200', budgetInvalid ? 'bg-danger/60' : 'bg-accent-blue')} style={{ width: `${meterPercent ?? 0}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-text-secondary"><span>{settings.minMaxIterations}</span><span>{settings.maxMaxIterations}</span></div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {presets.map(preset => <button key={preset} type="button" disabled={!canEdit || savingBudget} onClick={() => { setBudget(String(preset)); setNotice(''); }} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors active:translate-y-px disabled:opacity-60', currentValue === preset && !budgetInvalid ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary hover:bg-elevated hover:text-text-primary')}>
            {preset === settings.defaultMaxIterations ? `Default · ${preset}` : preset}
          </button>)}
        </div>
      </div>
      <p className="text-xs tabular-nums text-text-secondary">Current limit: {settings.effectiveMaxIterations} · allowed range {settings.minMaxIterations}–{settings.maxMaxIterations}</p>
      {budgetInvalid && <p className="text-xs text-danger">Enter a whole number between {settings.minMaxIterations} and {settings.maxMaxIterations}, or clear it to use the workspace default.</p>}
      <div className="flex items-center gap-3"><button type="submit" disabled={!canEdit || savingBudget || budgetUnchanged || budgetInvalid} className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white transition active:translate-y-px disabled:opacity-40">{savingBudget ? 'Saving…' : 'Save budget'}</button></div>
      {!canEdit && <p className="text-xs text-text-secondary">Only a workspace owner can change the reasoning budget.</p>}
    </form>
    <form onSubmit={saveTemperature} className="space-y-5 border-t border-border pt-8">
      <div><h4 className="font-medium">Temperature</h4><p className="mt-1 text-sm leading-6 text-text-secondary">How much randomness this agent uses when generating replies. Lower is more precise and repeatable; higher is more varied and creative. Applies to conversation replies and the agent console.</p></div>
      <div className="rounded-xl border border-border bg-canvas p-4">
        <label className="block text-sm font-medium">Temperature
          <input type="number" min={settings.minTemperature} max={settings.maxTemperature} step={0.1} value={temperature}
                 onChange={event => { setTemperature(event.target.value); setNotice(''); }} disabled={!canEdit || savingTemperature}
                 placeholder={`Workspace default · ${settings.defaultTemperature}`}
                 className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2.5 text-sm font-medium tabular-nums text-text-primary outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-60" />
        </label>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div className={cn('h-full rounded-full transition-[width] duration-200', temperatureInvalid ? 'bg-danger/60' : 'bg-accent-blue')} style={{ width: `${temperatureMeterPercent ?? 0}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-text-secondary"><span>{settings.minTemperature} · Precise</span><span>{settings.maxTemperature} · Creative</span></div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {temperaturePresets.map(preset => <button key={preset} type="button" disabled={!canEdit || savingTemperature} onClick={() => { setTemperature(String(preset)); setNotice(''); }} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors active:translate-y-px disabled:opacity-60', currentTemperature === preset && !temperatureInvalid ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-secondary hover:bg-elevated hover:text-text-primary')}>
            {preset === settings.defaultTemperature ? `Default · ${preset}` : preset === settings.minTemperature ? `Precise · ${preset}` : preset === settings.maxTemperature ? `Creative · ${preset}` : preset}
          </button>)}
        </div>
      </div>
      <p className="text-xs tabular-nums text-text-secondary">Current temperature: {settings.effectiveTemperature} · allowed range {settings.minTemperature}–{settings.maxTemperature}</p>
      {temperatureInvalid && <p className="text-xs text-danger">Enter a number between {settings.minTemperature} and {settings.maxTemperature}, or clear it to use the workspace default.</p>}
      <div className="flex items-center gap-3"><button type="submit" disabled={!canEdit || savingTemperature || temperatureUnchanged || temperatureInvalid} className="rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white transition active:translate-y-px disabled:opacity-40">{savingTemperature ? 'Saving…' : 'Save temperature'}</button></div>
      {!canEdit && <p className="text-xs text-text-secondary">Only a workspace owner can change the agent temperature.</p>}
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </div>;
}
