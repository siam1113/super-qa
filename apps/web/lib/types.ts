export type PageKey = 'dashboard'|'executions'|'run'|'healer'|'context'|'flows'|'facts'|'actions'|'dom'|'data'|'testcases'|'coverage'|'prs'|'settings';
export type InspectorSelection = { type: string; title: string; status: string; confidence: string; meta?: Record<string,string> };
export type TestCase = { id:string; title:string; priority:string; automation:string; owner:string; flow:string; tags:string[]; lastRun:string; passRate:number; coverage:number; risk:string; aiScore:number };
export type Execution = { testName:string; flow:string; browser:string; environment:string; status:string; duration:string; retry:number; confidence:number; owner:string };
export type HealingSuggestion = { issue:string; affectedTests:number; locator:string; suggestedLocator:string; confidence:number; risk:string; owner:string };
export type Integration = { name:string; status:'Connected'|'Warning'|'Disconnected'; lastSync:string; permissions:string };
export type WorkspaceSeed = { executions:Execution[]; testCases:TestCase[]; healing:HealingSuggestion[]; integrations:Integration[] };
