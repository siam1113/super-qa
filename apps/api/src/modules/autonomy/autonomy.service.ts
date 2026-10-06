import { apiProfile, apiFlowResult } from './api-flow.contract';
import { WorkflowArtifact } from './workflow-artifact.entity';
import { RepairPatch, repositoryProfile, repositoryResult, validateRepositoryCases } from './repository.contract';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, MoreThan } from 'typeorm';
import { AutonomousRun, AutonomousSuite, ProjectKey, QaAuditEvent, QaOrganization, QaProject } from './autonomy.entity';
import { QaAuthSession, QaOrgInvitation, QaOrgMember, QaSuperAdmin } from './identity.entity';
import { CleanupReceiptDto, CompleteAutonomousRunDto, CreateBenchmarkDto, CreateSuiteDto, EnrollProjectDto, IssueKeyDto, OrganizationSupportSettingsDto, ProjectSettingsDto, StartAutonomousRunDto } from './autonomy.dto';
import { hashManifest, liveProfile, scalar, validateChecks, validateMaintenance } from './autonomy.contract';
import { HarnessService } from '../harness/harness.service';
import { HarnessExecutionService } from '../harness/execution.service';
import { QaBenchmark } from './benchmark.entity';
import { scoreBenchmark, validateCorpus } from './benchmark.contract';
import { AuthService } from './auth.service';
import { ChatAgent, ChatInstallation } from '../chat/chat.entity';
import { defaultOrganizationSupportSettings, OrganizationSupportSettings, QaOrgSupportSettings } from './org-support-settings.entity';

@Injectable()
export class AutonomyService {
  constructor(private readonly database: DataSource, private readonly harness: HarnessService, private readonly browser: HarnessExecutionService, @Optional() private readonly auth?: AuthService) {}

  async authenticate(header: string | undefined, sessionCookie?: string): Promise<ProjectKey> {
    if (header && /^Bearer sq_[a-f0-9]{64}$/.test(header)) {
      const digest = createHash('sha256').update(header.slice(7)).digest('hex');
      const key = await this.database.manager.findOneBy(ProjectKey, { digest });
      if (key && !key.revoked && key.expiresAt.getTime() > Date.now()) return key;
    }
    if (sessionCookie && this.auth) return this.auth.authenticateSession(sessionCookie);
    throw new UnauthorizedException();
  }

  private async audit(manager: EntityManager, projectId: string, actor: string, action: string, data: Record<string, unknown> = {}) {
    await manager.save(manager.create(QaAuditEvent, { projectId, actor, action, data }));
  }

  private async issue(manager: EntityManager, projectId: string, input: IssueKeyDto) {
    const secret = 'sq_' + randomBytes(32).toString('hex');
    const key = await manager.save(manager.create(ProjectKey, { projectId, digest: createHash('sha256').update(secret).digest('hex'), role: input.role, label: input.label, expiresAt: new Date(Date.now() + input.days * 86400000) }));
    return { id: key.id, role: key.role, expiresAt: key.expiresAt, secret };
  }

  private deploymentPolicy(project: QaProject) {
    let origins: unknown;
    try { origins = JSON.parse(process.env.AUTONOMY_ALLOWED_ORIGINS || '[]'); } catch { throw new ForbiddenException('Invalid deployment allowlist'); }
    if (!Array.isArray(origins) || project.origins.some(origin => !origins.includes(origin))) throw new ForbiddenException('Project origins are no longer deployment-approved');
  }

  async enroll(input: EnrollProjectDto, actor = 'super-admin') {
    if (input.adminEmail && process.env.NODE_ENV === 'production' && !(process.env.AUTH_PUBLIC_URL || '').startsWith('https://')) throw new ForbiddenException('A trusted HTTPS AUTH_PUBLIC_URL is required for admin invitations');
    let allowed: string[];
    let targets: Record<string, string>;
    try { allowed = JSON.parse(process.env.AUTONOMY_ALLOWED_ORIGINS || '[]'); targets = JSON.parse(process.env.HARNESS_EXECUTION_TARGETS || '{}'); } catch { throw new ForbiddenException('Invalid deployment allowlist'); }
    const projectInput = {
      ...input,
      workspaceId: input.workspaceId || randomUUID(),
      applicationId: input.applicationId || 'default',
      environment: input.environment || 'test',
      origins: input.origins || [],
      targets: input.targets || Object.keys(targets).slice(0, 1),
      requirements: input.requirements || ['Add your first quality requirement after setup'],
      dailyRunLimit: input.dailyRunLimit || 20,
    };
    if (!Array.isArray(allowed) || projectInput.origins.some(origin => {
      try { const url = new URL(origin); return !allowed.includes(origin) || url.origin !== origin || url.protocol !== 'https:' || Boolean(url.username || url.password); } catch { return true; }
    }) || projectInput.targets.some(target => !/^[a-f0-9]{64}$/.test(targets[target] || '')) || new Set(projectInput.requirements).size !== projectInput.requirements.length) throw new BadRequestException('Project policy is not deployment-approved');
    const enrolled = await this.database.transaction(async manager => {
      const { adminEmail, organizationName, organizationId, ...projectFields } = projectInput;
      let organization: QaOrganization;
      if (organizationId) {
        const existing = await manager.findOneBy(QaOrganization, { id: organizationId });
        if (!existing) throw new NotFoundException('Organization not found');
        organization = existing;
      } else {
        organization = await manager.save(manager.create(QaOrganization, { name: (organizationName || projectFields.name).trim() }));
      }
      const project = await manager.save(manager.create(QaProject, { ...projectFields, organizationId: organization.id }));
      const credential = adminEmail ? null : await this.issue(manager, project.id, { role: 'owner', label: 'bootstrap owner', days: 7 });
      await this.audit(manager, project.id, actor, 'project.enrolled', { adminEmail: adminEmail || null, organizationId: organization.id });
      return { organization, project, adminEmail: adminEmail || null, credential };
    });
    if (!input.adminEmail) return enrolled;
    if (!this.auth) throw new ForbiddenException('Identity service is not configured');
    const invitation = await this.auth.invite(enrolled.project.id, input.adminEmail, 'owner', null);
    return { ...enrolled, invitation };
  }

  async recoverOwner(projectId: string) {
    return this.database.transaction(async manager => {
      const project = await manager.findOne(QaProject, { where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!project) throw new NotFoundException();
      const credential = await this.issue(manager, projectId, { role: 'owner', label: 'break-glass recovery', days: 1 });
      await this.audit(manager, projectId, 'super-admin', 'owner.recovered', { keyId: credential.id });
      return credential;
    });
  }

  async inviteOrganizationMember(projectId: string, email: string, role: string, admin: QaSuperAdmin) {
    if (!this.auth) throw new ForbiddenException('Identity service is not configured');
    const project = await this.database.manager.findOneBy(QaProject, { id: projectId });
    if (!project) throw new NotFoundException();
    const invitation = await this.auth.invite(projectId, email, role, null);
    await this.database.manager.save(this.database.manager.create(QaAuditEvent, { projectId, actor: `super-admin:${admin.email}`, action: 'member.invited', data: { email: email.trim().toLowerCase(), role, invitationId: invitation.id } }));
    return invitation;
  }

  async startMemberImpersonation(projectId: string, memberId: string, admin: QaSuperAdmin) {
    if (!this.auth) throw new ForbiddenException('Identity service is not configured');
    const session = await this.auth.startImpersonation(admin.id, memberId, projectId);
    await this.database.manager.save(this.database.manager.create(QaAuditEvent, { projectId, actor: `super-admin:${admin.email}`, action: 'member.impersonation_started', data: { memberId, sessionExpiresAt: session.expiresAt.toISOString() } }));
    return session;
  }

  async recordImpersonationEnded(projectId: string, memberId: string, adminId: string) {
    const admin = await this.database.manager.findOneBy(QaSuperAdmin, { id: adminId });
    await this.database.manager.save(this.database.manager.create(QaAuditEvent, { projectId, actor: `super-admin:${admin?.email || adminId}`, action: 'member.impersonation_ended', data: { memberId } }));
  }

  async organizationList() {
    // Older deployments can have usable project/member records before the
    // organization backfill has run. Member authentication is project-scoped,
    // so those accounts still work while the parent-organization query is empty.
    // Repair that legacy shape here so the admin list and its management routes
    // see the same organizations as the existing app accounts.
    await this.database.transaction(async manager => {
      const unlinkedProjects = await manager.find(QaProject, {
        where: { organizationId: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      for (const project of unlinkedProjects) {
        const organization = await manager.save(manager.create(QaOrganization, {
          name: project.name,
          createdAt: project.createdAt,
        }));
        project.organizationId = organization.id;
        await manager.save(project);
      }
    });
    const projects = await this.database.manager.find(QaProject, { select: { id: true, organizationId: true, name: true, environment: true, paused: true, dailyRunLimit: true, createdAt: true }, order: { createdAt: 'DESC' } });
    const organizations = await this.database.manager.find(QaOrganization, { order: { createdAt: 'DESC' } });
    const projectIds = projects.map(project => project.id);
    if (!projectIds.length) return organizations.map(organization => ({ ...organization, appCount: 0, memberCount: 0, apps: [] }));
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const [runs, members, keys, agents, installations, supportSettingsRows, invitations] = await Promise.all([
      this.database.manager.createQueryBuilder(AutonomousRun, 'run')
        .select('run.projectId', 'projectId')
        .addSelect('COUNT(*)', 'totalRuns')
        .addSelect('COUNT(*) FILTER (WHERE run.createdAt >= :today)', 'runsToday')
        .addSelect("COUNT(*) FILTER (WHERE run.status = 'passed')", 'passedRuns')
        .addSelect("COUNT(*) FILTER (WHERE run.status IN ('queued', 'running'))", 'activeRuns')
        .where('run.projectId IN (:...projectIds)', { projectIds, today })
        .groupBy('run.projectId').getRawMany(),
      this.database.manager.find(QaOrgMember, { where: { projectId: In(projectIds) }, select: { id: true, projectId: true, email: true, keyId: true, active: true, createdAt: true }, order: { createdAt: 'DESC' } }),
      this.database.manager.find(ProjectKey, { where: { projectId: In(projectIds) }, select: { id: true, role: true } }),
      this.database.manager.find(ChatAgent, { where: { projectId: In(projectIds) }, select: { id: true, projectId: true, name: true, kind: true, enabled: true } }),
      this.database.manager.find(ChatInstallation, { where: { projectId: In(projectIds) }, select: { id: true, projectId: true, provider: true, name: true, accessMode: true, enabled: true } }),
      this.database.manager.find(QaOrgSupportSettings, { where: { projectId: In(projectIds) }, select: { projectId: true, settings: true } }),
      this.database.manager.find(QaOrgInvitation, { where: { projectId: In(projectIds), acceptedAt: IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }, select: { id: true, projectId: true, email: true, role: true, createdAt: true, expiresAt: true }, order: { createdAt: 'DESC' } }),
    ]);
    const keyRoles = new Map(keys.map(key => [key.id, key.role]));
    const runStats = new Map(runs.map(row => [row.projectId, row]));
    const membersByProject = new Map<string, Array<{ id: string; email: string; role: string; active: boolean; createdAt: Date }>>();
    const agentsByProject = new Map<string, Array<{ id: string; name: string; kind: string | null; enabled: boolean }>>();
    const servicesByProject = new Map<string, Array<{ id: string; name: string; provider: string; accessMode: string; enabled: boolean }>>();
    const supportSettingsByProject = new Map(supportSettingsRows.map(row => [row.projectId, row.settings]));
    const invitationsByProject = new Map<string, Array<{ id: string; email: string; role: string; createdAt: Date; expiresAt: Date }>>();
    for (const member of members) {
      const group = membersByProject.get(member.projectId) || [];
      group.push({ id: member.id, email: member.email, role: keyRoles.get(member.keyId) || 'member', active: member.active, createdAt: member.createdAt });
      membersByProject.set(member.projectId, group);
    }
    for (const agent of agents) {
      const group = agentsByProject.get(agent.projectId) || [];
      group.push({ id: agent.id, name: agent.name, kind: agent.kind, enabled: agent.enabled });
      agentsByProject.set(agent.projectId, group);
    }
    for (const installation of installations) {
      const group = servicesByProject.get(installation.projectId) || [];
      group.push({ id: installation.id, name: installation.name, provider: installation.provider, accessMode: installation.accessMode, enabled: installation.enabled });
      servicesByProject.set(installation.projectId, group);
    }
    for (const invitation of invitations) {
      const group = invitationsByProject.get(invitation.projectId) || [];
      group.push({ id: invitation.id, email: invitation.email, role: invitation.role, createdAt: invitation.createdAt, expiresAt: invitation.expiresAt });
      invitationsByProject.set(invitation.projectId, group);
    }
    const apps = projects.map(project => {
      const stats = runStats.get(project.id);
      const projectMembers = membersByProject.get(project.id) || [];
      return {
        ...project,
        members: projectMembers,
        memberCount: projectMembers.filter(member => member.active).length,
        invitations: invitationsByProject.get(project.id) || [],
        agents: agentsByProject.get(project.id) || [],
        services: servicesByProject.get(project.id) || [],
        supportSettings: supportSettingsByProject.get(project.id) || defaultOrganizationSupportSettings,
        runStats: {
          total: Number(stats?.totalRuns || 0),
          today: Number(stats?.runsToday || 0),
          passed: Number(stats?.passedRuns || 0),
          active: Number(stats?.activeRuns || 0),
        },
        commercial: { pricingConfigured: false, subscriptionConfigured: false },
      };
    });
    return organizations.map(organization => {
      const organizationApps = apps.filter(app => app.organizationId === organization.id);
      return {
        ...organization,
        appCount: organizationApps.length,
        memberCount: organizationApps.reduce((sum, app) => sum + app.memberCount, 0),
        apps: organizationApps,
      };
    });
  }

  async organizationForAdmin(projectId: string) {
    const app = await this.database.manager.findOne(QaProject, { where: { id: projectId }, select: { id: true, organizationId: true } });
    if (!app?.organizationId) throw new NotFoundException('Organization not found');
    return (await this.organizationList()).find(organization => organization.id === app.organizationId) || null;
  }

  async createOrganizationAppForAdmin(projectId: string, input: EnrollProjectDto, actor: string) {
    const app = await this.database.manager.findOne(QaProject, { where: { id: projectId }, select: { id: true, organizationId: true } });
    if (!app?.organizationId) throw new NotFoundException('Organization not found');
    return this.enroll({ ...input, organizationId: app.organizationId }, actor);
  }

  async organizationSupportSettings(projectId: string) {
    const project = await this.database.manager.findOne(QaProject, { where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException();
    const record = await this.database.manager.findOne(QaOrgSupportSettings, { where: { projectId } });
    return record?.settings || defaultOrganizationSupportSettings;
  }

  async updateOrganizationSettings(organizationId: string, projectId: string, input: ProjectSettingsDto, actor = 'super-admin') {
    return this.database.transaction(async manager => {
      const project = await manager.findOne(QaProject, { where: { id: projectId, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!project) throw new NotFoundException();
      if (!input.name.trim()) throw new BadRequestException('App name is required');
      project.name = input.name.trim();
      project.dailyRunLimit = input.dailyRunLimit;
      await manager.save(project);
      await this.audit(manager, project.id, actor, 'project.settings', { organizationId, name: project.name, dailyRunLimit: project.dailyRunLimit });
      return project;
    });
  }

  async updateOrganizationSettingsForAdmin(currentProjectId: string, appId: string, input: ProjectSettingsDto, actor: string) {
    const current = await this.database.manager.findOne(QaProject, { where: { id: currentProjectId }, select: { organizationId: true } });
    if (!current?.organizationId) throw new NotFoundException('Organization not found');
    return this.updateOrganizationSettings(current.organizationId, appId, input, actor);
  }

  async inviteAppMember(organizationId: string, projectId: string, email: string, role: string, actor: string) {
    if (!this.auth) throw new ForbiddenException('Identity service is not configured');
    const project = await this.database.manager.findOneBy(QaProject, { id: projectId, organizationId });
    if (!project) throw new NotFoundException('App not found in this organization');
    const invitation = await this.auth.invite(projectId, email, role, null);
    await this.database.manager.save(this.database.manager.create(QaAuditEvent, { projectId, actor, action: 'member.invited', data: { organizationId, email: email.trim().toLowerCase(), role, invitationId: invitation.id } }));
    return invitation;
  }

  async inviteAppMemberForAdmin(currentProjectId: string, appId: string, email: string, role: string, actor: string) {
    const current = await this.database.manager.findOne(QaProject, { where: { id: currentProjectId }, select: { organizationId: true } });
    if (!current?.organizationId) throw new NotFoundException('Organization not found');
    return this.inviteAppMember(current.organizationId, appId, email, role, actor);
  }

  async updateOrganizationSupportSettings(projectId: string, input: OrganizationSupportSettingsDto) {
    const providerOptions = {
      ticketing: ['none', 'zendesk', 'freshdesk', 'jira_service_management', 'custom'],
      liveChat: ['none', 'intercom', 'crisp', 'custom'],
    } as const;
    const normalize = (kind: keyof typeof providerOptions, value: OrganizationSupportSettingsDto['ticketing']) => {
      if (!providerOptions[kind].includes(value.provider as never)) throw new BadRequestException(`Unsupported ${kind === 'ticketing' ? 'ticketing' : 'live chat'} provider`);
      if (value.enabled && value.provider === 'none') throw new BadRequestException(`Choose a ${kind === 'ticketing' ? 'ticketing' : 'live chat'} provider before enabling it`);
      const baseUrl = (value.baseUrl || '').trim();
      if (value.enabled && !baseUrl) throw new BadRequestException('Add the integration workspace URL before enabling it');
      if (baseUrl) {
        try {
          const url = new URL(baseUrl);
          if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
        } catch { throw new BadRequestException('Integration URLs must use HTTPS and cannot contain credentials, query parameters, or fragments'); }
      }
      return { enabled: value.enabled, provider: value.provider, baseUrl, workspace: (value.workspace || '').trim(), queue: (value.queue || '').trim() };
    };
    const settings: OrganizationSupportSettings = { ticketing: normalize('ticketing', input.ticketing), liveChat: normalize('liveChat', input.liveChat) };
    return this.database.transaction(async manager => {
      const project = await manager.findOne(QaProject, { where: { id: projectId }, lock: { mode: 'pessimistic_write' } });
      if (!project) throw new NotFoundException();
      const existing = await manager.findOne(QaOrgSupportSettings, { where: { projectId } });
      const record = existing || manager.create(QaOrgSupportSettings, { projectId });
      record.settings = settings;
      await manager.save(record);
      await this.audit(manager, projectId, 'super-admin', 'organization.support_settings.updated', { ticketing: settings.ticketing.provider, ticketingEnabled: settings.ticketing.enabled, liveChat: settings.liveChat.provider, liveChatEnabled: settings.liveChat.enabled });
      return record.settings;
    });
  }

  private async scoped<T>(identity: ProjectKey, roles: string[], callback: (manager: EntityManager, project: QaProject, key: ProjectKey) => Promise<T>): Promise<T> {
    return this.database.transaction(async manager => {
      const project = await manager.findOne(QaProject, { where: { id: identity.projectId }, lock: { mode: 'pessimistic_write' } });
      const key = await manager.findOneBy(ProjectKey, { id: identity.id, projectId: identity.projectId });
      if (!project || !key || key.revoked || key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
      if (!roles.includes(key.role)) throw new ForbiddenException('Role cannot perform this action');
      await this.expire(manager, project.id);
      return callback(manager, project, key);
    });
  }

  private async expire(manager: EntityManager, projectId: string) {
    const active = await manager.findBy(AutonomousRun, [{ projectId, status: 'queued' }, { projectId, status: 'running' }]);
    for (const run of active) if (run.deadline.getTime() <= Date.now()) {
      run.status = 'interrupted';
      await manager.save(run);
      await this.audit(manager, projectId, 'watchdog', 'run.interrupted', { runId: run.id });
      for (const executionId of Object.values(run.browserExecutions)) await this.browser.cancel(executionId);
    }
  }

  async issueKey(identity: ProjectKey, input: IssueKeyDto) {
    return this.scoped(identity, ['owner'], async (manager, project, key) => {
      const credential = await this.issue(manager, project.id, input);
      await this.audit(manager, project.id, key.id, 'key.issued', { keyId: credential.id, role: input.role });
      return credential;
    });
  }

  async settings(identity: ProjectKey) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci'], async (manager, project, key) => {
      const credentials = key.role === 'owner' ? await manager.find(ProjectKey, { where: { projectId: project.id }, select: { id: true, role: true, label: true, expiresAt: true, revoked: true } }) : [];
      let liveProfiles: Array<Record<string, unknown>> = [];
      try {
        const registry = JSON.parse(process.env.AUTONOMY_LIVE_PROFILES || '{}');
        liveProfiles = Object.entries(registry).filter(([, value]: [string, any]) => value && value.environment === project.environment && project.origins.includes(value.origin)).map(([hash, value]: [string, any]) => ({ hash, origin: value.origin, environment: value.environment, assertions: value.assertions }));
      } catch { throw new BadRequestException('Invalid deployment live profile registry'); }
      return { project, identity: { id: key.id, role: key.role, expiresAt: key.expiresAt }, credentials, liveProfiles };
    });
  }

  async updateSettings(identity: ProjectKey, input: ProjectSettingsDto) {
    return this.scoped(identity, ['owner', 'admin'], async (manager, project, key) => {
      if (!input.name.trim()) throw new BadRequestException('Project name required');
      project.name = input.name.trim(); project.dailyRunLimit = input.dailyRunLimit;
      await manager.save(project);
      await this.audit(manager, project.id, key.id, 'project.settings', { name: project.name, dailyRunLimit: project.dailyRunLimit });
      return project;
    });
  }

  async revoke(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner'], async (manager, project, key) => {
      const target = await manager.findOneBy(ProjectKey, { id, projectId: project.id });
      if (!target) throw new NotFoundException();
      if (target.role === 'owner' && !target.revoked && await manager.count(ProjectKey, { where: { projectId: project.id, role: 'owner', revoked: false } }) <= 1) throw new ConflictException('Issue another Owner credential before revoking the last Owner');
      target.revoked = true; await manager.save(target);
      const member = await manager.findOneBy(QaOrgMember, { keyId: target.id, projectId: project.id });
      if (member) { member.active = false; member.tokenVersion += 1; await manager.save(member); await manager.update(QaAuthSession, { memberId: member.id, revokedAt: null }, { revokedAt: new Date() }); }
      await this.audit(manager, project.id, key.id, 'key.revoked', { keyId: id });
      return { revoked: true };
    });
  }

  async pause(identity: ProjectKey, paused: boolean) {
    return this.scoped(identity, ['owner', 'admin'], async (manager, project, key) => {
      project.paused = paused; await manager.save(project);
      if (paused) {
        const active = await manager.findBy(AutonomousRun, [{ projectId: project.id, status: 'queued' }, { projectId: project.id, status: 'running' }]);
        for (const run of active) {
          run.status = 'cancelled'; await manager.save(run);
          for (const executionId of Object.values(run.browserExecutions)) await this.browser.cancel(executionId);
        }
      }
      await this.audit(manager, project.id, key.id, 'project.pause', { paused });
      return { paused };
    });
  }

  private async validateBrowser(manager: EntityManager, project: QaProject, checks: AutonomousSuite['checks']) {
    for (const check of checks.filter(item => item.kind === 'api_flow')) apiProfile(check, project);
    for (const check of checks.filter(item => item.kind === 'repository')) await validateRepositoryCases(manager, project, repositoryProfile(check, project));
    for (const check of checks.filter(item => item.kind === 'live')) liveProfile(check, project);
    for (const check of checks.filter(item => item.kind === 'browser')) {
      if (!check.proposalRunId) throw new BadRequestException('Proposal required');
      const proposal = await this.harness.executionSnapshot(manager, check.proposalRunId);
      if (proposal.task.workspaceId !== project.workspaceId || proposal.task.applicationId !== project.applicationId || proposal.task.environment !== project.environment) throw new ForbiddenException('Browser proposal belongs to a different project scope');
    }
  }

  async createSuite(identity: ProjectKey, input: CreateSuiteDto) {
    return this.scoped(identity, ['owner', 'admin'], async (manager, project, key) => {
      const checks = validateChecks(input.checks, project);
      await this.validateBrowser(manager, project, checks);
      const prior = input.previousId ? await manager.findOneBy(AutonomousSuite, { id: input.previousId, projectId: project.id }) : null;
      if (input.previousId && !prior) throw new NotFoundException();
      if (prior) validateMaintenance(prior.checks, checks);
      const suite = await manager.save(manager.create(AutonomousSuite, { projectId: project.id, name: input.name, checks, previousId: prior?.id || null, version: prior ? prior.version + 1 : 1, manifestHash: hashManifest(checks), approvedBy: null }));
      await this.audit(manager, project.id, key.id, 'suite.created', { suiteId: suite.id, previousId: suite.previousId, manifestHash: suite.manifestHash });
      return suite;
    });
  }

  async describeSuite(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci'], async (manager, project) => {
      const suite = await manager.findOneBy(AutonomousSuite, { id, projectId: project.id });
      if (!suite) throw new NotFoundException();
      return { projectId: project.id, suite, apiProfiles: suite.checks.filter(check => check.kind === 'api_flow').map(check => apiProfile(check, project)), repositoryProfiles: suite.checks.filter(check => check.kind === 'repository').map(check => repositoryProfile(check, project)) };
    });
  }

  async approve(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner'], async (manager, project, key) => {
      const suite = await manager.findOneBy(AutonomousSuite, { id, projectId: project.id });
      if (!suite) throw new NotFoundException();
      await this.validateBrowser(manager, project, suite.checks);
      suite.approvedBy = key.id; await manager.save(suite);
      await this.audit(manager, project.id, key.id, 'suite.approved', { suiteId: id, manifestHash: suite.manifestHash });
      return suite;
    });
  }

  async start(identity: ProjectKey, input: StartAutonomousRunDto) {
    return this.scoped(identity, ['owner', 'admin', 'ci'], (manager, project, key) => this.queueRun(manager, project, key, input));
  }

  private async queueRun(manager: EntityManager, project: QaProject, key: ProjectKey, input: StartAutonomousRunDto) {
      const existing = await manager.findOneBy(AutonomousRun, { projectId: project.id, requestId: input.requestId });
      if (existing) {
        if (existing.suiteId !== input.suiteId || (existing.dataset?.requestId || undefined) !== input.datasetRequestId || (existing.dataset?.contentHash || undefined) !== input.datasetContentHash || (existing.repairPatch?.diffHash || undefined) !== (input.repairPatch ? createHash('sha256').update(input.repairPatch.diff).digest('hex') : undefined)) throw new ConflictException('Idempotency input changed');
        return this.view(existing);
      }
      if (project.paused) throw new ConflictException('Project paused');
      this.deploymentPolicy(project);
      const count = await manager.createQueryBuilder(AutonomousRun, 'run').where('run.projectId = :id AND run.createdAt >= :start', { id: project.id, start: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') }).getCount();
      if (count >= project.dailyRunLimit) throw new ConflictException('Daily run quota exhausted');
      const suite = await manager.findOneBy(AutonomousSuite, { id: input.suiteId, projectId: project.id });
      if (!suite?.approvedBy) throw new ConflictException('Approved suite required');
      await this.validateBrowser(manager, project, suite.checks);
      const dataset = await this.resolveDataset(manager, project, suite, input);
      const repairPatch = this.resolveRepairPatch(suite, project, input);
      const run = await manager.save(manager.create(AutonomousRun, { projectId: project.id, requestId: input.requestId, suiteId: suite.id, snapshot: suite, dataset, repairPatch, deadline: new Date(Date.now() + 300000) }));
      await this.audit(manager, project.id, key.id, 'run.queued', { runId: run.id });
      return this.view(run);
  }

  private async resolveDataset(manager: EntityManager, project: QaProject, suite: AutonomousSuite, input: StartAutonomousRunDto) {
    const check = suite.checks.find(item => ['repository', 'api_flow'].includes(item.kind));
    const profile = check ? check.kind === 'api_flow' ? apiProfile(check, project) : repositoryProfile(check, project) : null;
    if (!profile?.datasetProfileHash) {
      if (input.datasetRequestId || input.datasetContentHash) throw new BadRequestException('This suite does not accept a dataset');
      return null;
    }
    if (!input.datasetRequestId || !input.datasetContentHash) throw new BadRequestException('A published dataset artifact is required');
    const artifact = await manager.findOneBy(WorkflowArtifact, { projectId: project.id, requestId: input.datasetRequestId, contentHash: input.datasetContentHash, skill: 'prepare_test_data', status: 'completed' });
    if (!artifact || !['qae', 'aue'].includes(artifact.agentType)) throw new BadRequestException('Dataset artifact is unavailable in this app');
    const plan = JSON.parse(artifact.resultJson).data;
    if (!plan || plan.schema_version !== 1 || plan.state !== 'prepared' || plan.profile_hash !== profile.datasetProfileHash || plan.environment !== project.environment || !Number.isInteger(plan.seed) || !/^[a-f0-9]{64}$/.test(plan.fixture_hash) || !Array.isArray(plan.records) || !plan.records.length || plan.records.length > 100 || Buffer.byteLength(JSON.stringify(plan)) > 60000) throw new BadRequestException('Dataset does not match the approved suite blueprint');
    return { requestId: artifact.requestId, contentHash: artifact.contentHash, plan };
  }

  private resolveRepairPatch(suite: AutonomousSuite, project: QaProject, input: StartAutonomousRunDto) {
    if (!input.repairPatch) return null;
    const repositoryChecks = suite.checks.filter(check => check.kind === 'repository');
    if (repositoryChecks.length !== 1) throw new BadRequestException('A proposed repair requires exactly one repository check');
    const profile = repositoryProfile(repositoryChecks[0], project);
    if (!profile.allowedRepairPaths?.includes(input.repairPatch.path)) throw new BadRequestException('Repair path is not approved for this repository profile');
    return { path: input.repairPatch.path, diff: input.repairPatch.diff, baseContentHash: input.repairPatch.baseContentHash, diffHash: createHash('sha256').update(input.repairPatch.diff).digest('hex') };
  }

  async cleanup(identity: ProjectKey, id: string, input: CleanupReceiptDto) {
    return this.scoped(identity, ['runner'], async (manager, project, key) => {
      const run = await this.ownedRun(manager, project.id, id);
      const sameWorker = run.workerKeyId === key.id;
      const terminal = !['queued', 'running'].includes(run.status);
      if ((!sameWorker && !terminal) || run.token !== input.token || !run.snapshot.checks.some(check => ['repository', 'api_flow'].includes(check.kind))) throw new ConflictException('Wrong execution worker lease');
      if (run.cleanupReceipt?.container === 'clean' && input.container !== 'clean' || run.cleanupReceipt?.dataset === 'clean' && input.dataset !== 'clean') throw new ConflictException('Cleanup receipts cannot regress');
      run.cleanupReceipt = { container: input.container, dataset: input.dataset, recordedAt: new Date().toISOString() };
      await manager.save(run);
      await this.audit(manager, project.id, key.id, 'run.cleanup', { runId: id, container: input.container, dataset: input.dataset });
      return this.view(run);
    });
  }

  async createBenchmark(identity: ProjectKey, input: CreateBenchmarkDto) {
    return this.scoped(identity, ['owner', 'admin'], async (manager, project, key) => {
      const existing = await manager.findOneBy(QaBenchmark, { projectId: project.id, requestId: input.requestId });
      if (existing) {
        if (existing.corpusHash !== hashManifest(input.corpus)) throw new ConflictException('Benchmark idempotency input changed');
        return this.benchmarkView(manager, existing);
      }
      const corpus = validateCorpus(input.corpus, project.id, await manager.findBy(AutonomousSuite, { projectId: project.id }));
      const benchmark = await manager.save(manager.create(QaBenchmark, { projectId: project.id, requestId: input.requestId, corpus, corpusHash: hashManifest(input.corpus), approvedBy: null }));
      await this.audit(manager, project.id, key.id, 'benchmark.created', { benchmarkId: benchmark.id, corpusHash: benchmark.corpusHash });
      return this.benchmarkView(manager, benchmark);
    });
  }

  private async ownedBenchmark(manager: EntityManager, projectId: string, id: string) {
    const benchmark = await manager.findOneBy(QaBenchmark, { id, projectId });
    if (!benchmark) throw new NotFoundException();
    return benchmark;
  }

  private async benchmarkView(manager: EntityManager, benchmark: QaBenchmark) {
    const persisted = benchmark.runIds.length ? await manager.findBy(AutonomousRun, { id: In(benchmark.runIds), projectId: benchmark.projectId }) : [];
    const byId = new Map(persisted.map(run => [run.id, run]));
    const runs = benchmark.runIds.map(id => byId.get(id));
    const report = scoreBenchmark(benchmark.corpus, runs.map(run => run || undefined));
    const trials = benchmark.corpus.samples.flatMap((sample, sampleIndex) => Array.from({ length: benchmark.corpus.repetitions }, (_, repetition) => {
      const run = runs[sampleIndex * benchmark.corpus.repetitions + repetition];
      return { sampleId: sample.id, repetition, run: run ? this.view(run) : null };
    }));
    return { ...benchmark, status: !benchmark.approvedBy ? 'draft' : report.completed === report.samples ? 'completed' : benchmark.paused ? 'paused' : 'collecting', report, trials, evidenceHash: hashManifest(trials) };
  }

  async benchmarks(identity: ProjectKey) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci'], async (manager, project) => {
      const benchmarks = await manager.find(QaBenchmark, { where: { projectId: project.id }, order: { createdAt: 'DESC' }, take: 100 });
      return benchmarks.map(({ id, corpus, corpusHash, approvedBy, paused, createdAt }) => ({ id, name: corpus.name, kind: corpus.kind, corpusHash, approvedBy, paused, createdAt }));
    });
  }

  async benchmark(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci'], async (manager, project) => this.benchmarkView(manager, await this.ownedBenchmark(manager, project.id, id)));
  }

  // Platform-wide, super-admin-only view of agent accuracy across every app's benchmarks —
  // unlike benchmarks()/benchmark() above, this isn't scoped to one project's credential.
  async agentHealth() {
    const benchmarks = await this.database.manager.find(QaBenchmark, { order: { createdAt: 'DESC' }, take: 50 });
    if (!benchmarks.length) return [];
    const projectIds = [...new Set(benchmarks.map(benchmark => benchmark.projectId))];
    const projects = await this.database.manager.find(QaProject, { where: { id: In(projectIds) }, select: { id: true, name: true } });
    const projectNames = new Map(projects.map(project => [project.id, project.name]));
    return Promise.all(benchmarks.map(async benchmark => {
      const { status, report } = await this.benchmarkView(this.database.manager, benchmark);
      return { id: benchmark.id, projectId: benchmark.projectId, projectName: projectNames.get(benchmark.projectId) || 'Unknown app', name: benchmark.corpus.name, kind: benchmark.corpus.kind, status, report, createdAt: benchmark.createdAt };
    }));
  }

  async benchmarkAction(identity: ProjectKey, id: string, action: 'approve' | 'resume' | 'pause' | 'advance') {
    return this.scoped(identity, action === 'approve' ? ['owner'] : ['owner', 'admin', 'ci'], async (manager, project, key) => {
      const benchmark = await this.ownedBenchmark(manager, project.id, id);
      if (action === 'approve') {
        validateCorpus(benchmark.corpus as unknown as Record<string, unknown>, project.id, await manager.findBy(AutonomousSuite, { projectId: project.id }));
        benchmark.approvedBy = key.id;
      } else if (action === 'pause') benchmark.paused = true;
      else {
        if (!benchmark.approvedBy) throw new ConflictException('Reviewed benchmark approval required');
        if (project.paused) throw new ConflictException('Project paused');
        if (action === 'resume') benchmark.paused = false;
        else if (!benchmark.paused && benchmark.runIds.length < benchmark.corpus.samples.length * benchmark.corpus.repetitions) {
          const active = await manager.countBy(AutonomousRun, [{ projectId: project.id, status: 'queued' }, { projectId: project.id, status: 'running' }]);
          if (!active) {
            const sample = benchmark.corpus.samples[Math.floor(benchmark.runIds.length / benchmark.corpus.repetitions)];
            const run = await this.queueRun(manager, project, key, { requestId: randomUUID(), suiteId: sample.suiteId });
            if (run.snapshot.manifestHash !== sample.manifestHash) throw new ConflictException('Benchmark suite drift');
            benchmark.runIds.push(run.id);
            await this.audit(manager, project.id, key.id, 'benchmark.trial', { benchmarkId: id, runId: run.id, trial: benchmark.runIds.length - 1 });
          }
        }
      }
      await manager.save(benchmark);
      if (action !== 'advance') await this.audit(manager, project.id, key.id, 'benchmark.' + action, { benchmarkId: id });
      return this.benchmarkView(manager, benchmark);
    });
  }

  private view(run: AutonomousRun) {
    const { token, workerKeyId, completionHash, ...visible } = run;
    return { ...visible, modelCalls: 0, modelCostNanoUsd: 0, infrastructureCostMeasured: false };
  }

  async claim(identity: ProjectKey) {
    return this.scoped(identity, ['runner'], async (manager, project, key) => {
      if (project.paused || await manager.countBy(AutonomousRun, { projectId: project.id, status: 'running' })) return null;
      this.deploymentPolicy(project);
      const run = await manager.findOne(AutonomousRun, { where: { projectId: project.id, status: 'queued' }, order: { createdAt: 'ASC' } });
      if (!run) return null;
      await this.validateBrowser(manager, project, run.snapshot.checks);
      run.status = 'running'; run.token = randomUUID(); run.workerKeyId = key.id;
      await manager.save(run); await this.audit(manager, project.id, key.id, 'run.claimed', { runId: run.id });
      return { ...this.view(run), token: run.token };
    });
  }

  private async ownedRun(manager: EntityManager, projectId: string, id: string) {
    const run = await manager.findOneBy(AutonomousRun, { id, projectId });
    if (!run) throw new NotFoundException();
    return run;
  }

  async status(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci', 'runner'], async (manager, project) => {
      const run = await this.ownedRun(manager, project.id, id);
      let executionAllowed = !project.paused && run.status === 'running';
      if (executionAllowed && run.snapshot.checks.some(check => ['repository', 'api_flow'].includes(check.kind))) {
        try { this.deploymentPolicy(project); await this.validateBrowser(manager, project, run.snapshot.checks); }
        catch { executionAllowed = false; }
      }
      return { ...this.view(run), executionAllowed };
    });
  }

  async cancel(identity: ProjectKey, id: string) {
    return this.scoped(identity, ['owner', 'admin'], async (manager, project, key) => {
      const run = await this.ownedRun(manager, project.id, id);
      if (['queued', 'running'].includes(run.status)) {
        run.status = 'cancelled'; await manager.save(run);
        for (const executionId of Object.values(run.browserExecutions)) await this.browser.cancel(executionId);
        await this.audit(manager, project.id, key.id, 'run.cancelled', { runId: id });
      }
      return this.view(run);
    });
  }

  async dispatchBrowser(identity: ProjectKey, id: string, checkId: string, token: string) {
    return this.scoped(identity, ['runner'], async (manager, project, key) => {
      const run = await this.ownedRun(manager, project.id, id);
      if (project.paused || run.status !== 'running' || run.token !== token || run.workerKeyId !== key.id) throw new ConflictException('Run lease not current');
      const check = run.snapshot.checks.find(item => item.id === checkId && item.kind === 'browser');
      if (!check?.proposalRunId || !check.targetId || !check.bindings) throw new NotFoundException();
      if (!run.browserExecutions[checkId]) {
        const hex = hashManifest([run.id, checkId]);
        const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const execution = await this.browser.submit({ requestId, proposalRunId: check.proposalRunId, targetId: check.targetId, actor: 'autonomy:' + run.id, preconditionsConfirmed: true, bindings: check.bindings });
        run.browserExecutions[checkId] = execution.id; await manager.save(run);
        await this.audit(manager, project.id, key.id, 'browser.dispatched', { runId: id, checkId, executionId: execution.id });
      }
      return this.browser.status(run.browserExecutions[checkId]);
    });
  }

  async complete(identity: ProjectKey, id: string, input: CompleteAutonomousRunDto) {
    return this.scoped(identity, ['runner'], async (manager, project, key) => {
      const run = await this.ownedRun(manager, project.id, id);
      if (run.workerKeyId !== key.id || run.token !== input.token) throw new ConflictException('Wrong worker lease');
      if (run.completionHash === hashManifest(input)) return this.view(run);
      if (project.paused || run.status !== 'running') throw new ConflictException('Run is not active');
      this.deploymentPolicy(project);
      const apiChecks = run.snapshot.checks.filter(check => check.kind === 'api');
      if (input.observations.length !== apiChecks.length || new Set(input.observations.map(item => item.checkId)).size !== apiChecks.length || input.observations.some(item => !apiChecks.some(check => check.id === item.checkId) || (item.actual !== undefined && !scalar(item.actual)))) throw new BadRequestException('Exactly one bounded observation per API check required');
      const flowChecks = run.snapshot.checks.filter(check => check.kind === 'api_flow');
      const flowObservations = input.apiFlowObservations || [];
      if (flowObservations.length !== flowChecks.length || new Set(flowObservations.map(item => item.checkId)).size !== flowChecks.length || flowObservations.some(item => !flowChecks.some(check => check.id === item.checkId))) throw new BadRequestException('Exactly one observation per API flow required');
      const results: Array<Record<string, unknown>> = [];
      const repositoryChecks = run.snapshot.checks.filter(check => check.kind === 'repository');
      const repositoryObservations = input.repositoryObservations || [];
      if (repositoryObservations.length !== repositoryChecks.length || new Set(repositoryObservations.map(item => item.checkId)).size !== repositoryChecks.length || repositoryObservations.some(item => !repositoryChecks.some(check => check.id === item.checkId))) throw new BadRequestException('Exactly one observation per repository check required');
      const liveChecks = run.snapshot.checks.filter(check => check.kind === 'live');
      const liveObservations = input.liveObservations || [];
      if (liveObservations.length !== liveChecks.length || new Set(liveObservations.map(item => item.checkId)).size !== liveChecks.length || liveObservations.some(item => !liveChecks.some(check => check.id === item.checkId && check.profileHash === item.profileHash))) throw new BadRequestException('Exactly one observation per live workflow required');
      for (const check of run.snapshot.checks) {
        if (check.kind === 'api_flow') {
          results.push(apiFlowResult(check, apiProfile(check, project), flowObservations.find(item => item.checkId === check.id)!, Boolean(run.dataset)));
        } else if (check.kind === 'repository') {
          const profile = repositoryProfile(check, project);
          await validateRepositoryCases(manager, project, profile);
          results.push(repositoryResult(check, profile, repositoryObservations.find(item => item.checkId === check.id)!, Boolean(run.dataset), (run.repairPatch || undefined) as RepairPatch | undefined));
        } else if (check.kind === 'live') {
          liveProfile(check, project);
          const observation = liveObservations.find(item => item.checkId === check.id)!;
          const complete = !observation.error && observation.cleanup === 'clean' && /^[a-f0-9]{64}$/.test(observation.artifactHash) && observation.assertions.length === check.assertions!.length;
          const status = !complete ? 'error' : observation.assertions.every((item, index) => item.visible && item.actual === check.assertions![index]) ? 'passed' : 'failed';
          results.push({ checkId: check.id, status, observation, classification: status === 'failed' ? 'assertion_mismatch' : status === 'passed' ? 'verified' : 'infrastructure_or_missing_evidence' });
        } else if (check.kind === 'api') {
          const observation = input.observations.find(item => item.checkId === check.id);
          if (!observation) throw new BadRequestException('Missing observation');
          const status = observation.error || observation.actual === undefined ? 'error' : observation.status === check.expectedStatus && observation.actual === check.expected ? 'passed' : 'failed';
          results.push({ checkId: check.id, status, classification: status === 'failed' ? 'assertion_mismatch' : status === 'error' ? 'infrastructure_or_missing_evidence' : 'verified', observation });
        } else {
          const executionId = run.browserExecutions[check.id];
          if (!executionId) throw new ConflictException('Browser execution not dispatched');
          const execution = await this.browser.status(executionId);
          if (['queued', 'running'].includes(execution.status)) throw new ConflictException('Browser execution still active');
          results.push({ checkId: check.id, status: execution.status, executionId, artifactHash: execution.artifactHash, flaky: execution.flaky, classification: execution.status === 'failed' ? 'assertion_mismatch' : execution.status === 'passed' ? 'verified' : 'infrastructure_or_missing_evidence' });
        }
      }
      run.results = results; run.status = results.some(result => result.status === 'failed') ? 'failed' : results.every(result => result.status === 'passed' && !result.flaky) ? 'passed' : 'error';
      run.completionHash = hashManifest(input); await manager.save(run);
      await this.audit(manager, project.id, key.id, 'run.completed', { runId: id, status: run.status });
      return this.view(run);
    });
  }

  async overview(identity: ProjectKey) {
    return this.scoped(identity, ['owner', 'admin', 'member', 'ci'], async (manager, project) => {
      const suites = await manager.findBy(AutonomousSuite, { projectId: project.id });
      const covered = new Set(suites.filter(suite => suite.approvedBy).flatMap(suite => suite.checks.map(check => check.requirement)));
      const runs = await manager.find(AutonomousRun, { where: { projectId: project.id }, order: { createdAt: 'DESC' }, take: 100 });
      const audit = await manager.find(QaAuditEvent, { where: { projectId: project.id }, order: { createdAt: 'DESC' }, take: 100 });
      const gaps = project.requirements.filter(item => !covered.has(item));
      const active = await manager.countBy(AutonomousRun, [{ projectId: project.id, status: 'queued' }, { projectId: project.id, status: 'running' }]);
      return { project, suites, coverage: { meaning: 'declared requirement mapping, not proven behavioral coverage', total: project.requirements.length, mapped: covered.size, gaps }, runs: runs.map(run => this.view(run)), audit,
        attention: runs.filter(run => !['queued', 'running', 'passed'].includes(run.status)).map(run => ({ runId: run.id, status: run.status, action: run.status === 'failed' ? 'Review observation mismatch; product root cause is not established' : 'Resolve uncertainty before authorizing a new run' })),
        monitoring: { recentRunLimit: 100, recentAuditLimit: 100, active, lastRecentClaimAt: audit.find(event => event.action === 'run.claimed')?.createdAt || null, expiryMode: 'on authenticated poll; configure external polling/alert delivery' } };
    });
  }
}
