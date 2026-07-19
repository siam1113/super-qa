import { Controller, Get } from '@nestjs/common';
@Controller('workspace')
export class WorkspaceController { @Get() getWorkspace() { return { id: 'enterprise-demo', name: 'Enterprise QA Workspace', featureFlags: ['ai-healing', 'knowledge-graph', 'agent-prs'] }; } }
