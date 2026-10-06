import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createPublicKey, randomBytes, scrypt as scryptCallback, timingSafeEqual, verify as verifySignature } from 'crypto';
import { promisify } from 'util';
import { DataSource, In, IsNull } from 'typeorm';
import { ProjectKey, QaOrganization, QaProject } from './autonomy.entity';
import { QaAuthSession, QaOidcAttempt, QaOrgInvitation, QaOrgMember, QaSuperAdmin } from './identity.entity';

const scrypt = promisify(scryptCallback);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const roles = ['owner', 'admin', 'member'];

@Injectable()
export class AuthService {
  constructor(private readonly database: DataSource) {}

  private async hashPassword(password: string) {
    if (password.length < 12 || password.length > 256) throw new BadRequestException('Password must contain 12 to 256 characters');
    const salt = randomBytes(16).toString('hex');
    const derived = await scrypt(password, salt, 64) as Buffer;
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string) {
    const [scheme, salt, expectedHex] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(expectedHex || '')) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await scrypt(password, salt, expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
  }

  async invite(projectId: string, emailValue: string, role: string, createdBy: string | null) {
    const email = normalizeEmail(emailValue);
    if (!validEmail(email) || !roles.includes(role)) throw new BadRequestException('A valid email and supported member role are required');
    if (await this.database.manager.findOneBy(QaSuperAdmin, { email })) throw new ConflictException('This email is reserved for a super admin account');
    const publicUrl = new URL(process.env.AUTH_PUBLIC_URL || 'http://localhost:3000');
    if (process.env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') throw new ServiceUnavailableException('A trusted HTTPS AUTH_PUBLIC_URL is required for invitations');
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new ServiceUnavailableException('AUTH_PUBLIC_URL is invalid');
    const existing = await this.database.manager.findOneBy(QaOrgMember, { projectId, email, active: true });
    if (existing) throw new ConflictException('This person already has access to this app');
    const pending = await this.database.manager.findOne(QaOrgInvitation, { where: { projectId, email, acceptedAt: IsNull(), revokedAt: IsNull() } });
    if (pending && pending.expiresAt.getTime() > Date.now()) throw new ConflictException('An active invitation already exists');
    const secret = randomBytes(32).toString('base64url');
    const ownerKey = 'sq_' + randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const keyExpiresAt = new Date(Date.now() + 3650 * 86400000);
    const invite = await this.database.transaction(async manager => {
      if (pending) { pending.revokedAt = new Date(); await manager.save(pending); }
      const key = await manager.save(manager.create(ProjectKey, { projectId, digest: digest(ownerKey), role, label: email, expiresAt: keyExpiresAt }));
      return manager.save(manager.create(QaOrgInvitation, { projectId, email, role, tokenDigest: digest(secret), expiresAt, acceptedAt: null, revokedAt: null, createdBy, memberKeyId: key.id }));
    });
    const inviteUrl = new URL('/invite/accept', publicUrl);
    inviteUrl.searchParams.set('token', secret);
    try {
      const delivered = await this.sendInvite(email, inviteUrl.toString());
      return { id: invite.id, email, role, expiresAt, delivery: delivered ? 'email_sent' : 'manual', inviteUrl: delivered ? undefined : inviteUrl.toString() };
    } catch (error) {
      return { id: invite.id, email, role, expiresAt, delivery: 'email_failed_manual', inviteUrl: inviteUrl.toString(), deliveryError: error instanceof Error ? error.message : 'Email delivery failed' };
    }
  }

  private async sendInvite(email: string, inviteUrl: string) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return false;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.AUTH_FROM_EMAIL || 'Super QA <onboarding@resend.dev>', to: [email], subject: 'You are invited to Super QA', text: `Accept your organization invitation: ${inviteUrl}\nThis link expires in 7 days.`, html: `<p>You are invited to Super QA.</p><p><a href="${inviteUrl}">Accept invitation</a></p><p>This link expires in 7 days.</p>` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ServiceUnavailableException('Invitation email delivery failed');
    return true;
  }

  async acceptInvitation(token: string, password: string) {
    if (!/^[-_A-Za-z0-9]{40,60}$/.test(token)) throw new BadRequestException('Invalid invitation');
    return this.database.transaction(async manager => {
      const invitation = await manager.findOne(QaOrgInvitation, { where: { tokenDigest: digest(token) }, lock: { mode: 'pessimistic_write' } });
      if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Invitation is invalid or expired');
      const existingMemberships = await manager.find(QaOrgMember, { where: { email: invitation.email, active: true }, lock: { mode: 'pessimistic_write' } });
      let sharedPasswordHash: string | null = null;
      for (const existing of existingMemberships) {
        if (existing.passwordHash && await this.verifyPassword(password, existing.passwordHash)) { sharedPasswordHash = existing.passwordHash; break; }
      }
      if (existingMemberships.length && !sharedPasswordHash) throw new ConflictException('This email already has an account. Use its current password to join another app.');
      const member = await manager.findOne(QaOrgMember, { where: { projectId: invitation.projectId, email: invitation.email }, lock: { mode: 'pessimistic_write' } });
      if (member?.active) throw new ConflictException('Account already activated for this app');
      const passwordHash = sharedPasswordHash || await this.hashPassword(password);
      const saved = member || manager.create(QaOrgMember, { email: invitation.email, projectId: invitation.projectId, keyId: invitation.memberKeyId });
      saved.projectId = invitation.projectId; saved.keyId = invitation.memberKeyId; saved.passwordHash = passwordHash; saved.active = true; saved.tokenVersion = (saved.tokenVersion || 0) + 1;
      invitation.acceptedAt = new Date();
      await manager.save(invitation); await manager.save(saved);
      return this.createSession(manager, saved);
    });
  }

  async login(emailValue: string, password: string) {
    const email = normalizeEmail(emailValue);
    const memberships = await this.database.manager.find(QaOrgMember, { where: { email, active: true }, order: { createdAt: 'ASC' } });
    for (const member of memberships) if (member.passwordHash && await this.verifyPassword(password, member.passwordHash)) return this.database.transaction(manager => this.createSession(manager, member));
    const superAdmin = await this.database.manager.findOneBy(QaSuperAdmin, { email, active: true });
    if (!superAdmin || !await this.verifyPassword(password, superAdmin.passwordHash)) throw new UnauthorizedException('Email or password is incorrect');
    return this.database.transaction(manager => this.createSuperAdminSession(manager, superAdmin));
  }

  private async createSession(manager: import('typeorm').EntityManager, member: QaOrgMember) {
    const secret = 'qs_' + randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 3600000);
    await manager.save(manager.create(QaAuthSession, { memberId: member.id, superAdminId: null, impersonatedBySuperAdminId: null, tokenDigest: digest(secret), expiresAt, revokedAt: null }));
    const key = await manager.findOneBy(ProjectKey, { id: member.keyId, projectId: member.projectId });
    const project = await manager.findOneBy(QaProject, { id: member.projectId });
    return { token: secret, expiresAt, user: { id: member.id, email: member.email, role: key?.role, projectId: member.projectId, accountType: 'organization', onboardingCompleted: Boolean(project?.onboardingCompletedAt), apps: await this.appsForMember(manager, member.email) } };
  }

  private async appsForMember(manager: import('typeorm').EntityManager, email: string) {
    const memberships = await manager.find(QaOrgMember, { where: { email, active: true }, order: { createdAt: 'ASC' } });
    if (!memberships.length) return [];
    const projects = await manager.find(QaProject, { where: { id: In(memberships.map(member => member.projectId)) } });
    const projectById = new Map(projects.map(project => [project.id, project]));
    const organizationIds = [...new Set(projects.map(project => project.organizationId).filter((id): id is string => Boolean(id)))];
    const organizations = organizationIds.length ? await manager.find(QaOrganization, { where: { id: In(organizationIds) } }) : [];
    const organizationById = new Map(organizations.map(organization => [organization.id, organization]));
    const keys = await manager.find(ProjectKey, { where: { id: In(memberships.map(member => member.keyId)) } });
    const roleByKeyId = new Map(keys.map(key => [key.id, key.role]));
    return memberships.flatMap(member => {
      const project = projectById.get(member.projectId);
      if (!project) return [];
      const organization = project.organizationId ? organizationById.get(project.organizationId) : null;
      return [{ projectId: project.id, appName: project.name, organizationId: organization?.id || null, organizationName: organization?.name || null, role: roleByKeyId.get(member.keyId) || 'member' }];
    });
  }

  private async createSuperAdminSession(manager: import('typeorm').EntityManager, admin: QaSuperAdmin) {
    const secret = 'qs_' + randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 3600000);
    await manager.save(manager.create(QaAuthSession, { memberId: null, superAdminId: admin.id, impersonatedBySuperAdminId: null, tokenDigest: digest(secret), expiresAt, revokedAt: null }));
    return { token: secret, expiresAt, user: { id: admin.id, email: admin.email, role: 'super_admin', accountType: 'super_admin' } };
  }

  async authenticateSession(token: string | undefined) {
    if (!token || !/^qs_[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const session = await this.database.manager.findOneBy(QaAuthSession, { tokenDigest: digest(token) });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    if (!session.memberId || session.superAdminId) throw new UnauthorizedException();
    const member = await this.database.manager.findOneBy(QaOrgMember, { id: session.memberId, active: true });
    if (!member) throw new UnauthorizedException();
    const key = await this.database.manager.findOneBy(ProjectKey, { id: member.keyId, projectId: member.projectId });
    if (!key || key.revoked || key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    return key;
  }

  async session(token: string | undefined) {
    if (!token || !/^qs_[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const session = await this.database.manager.findOneBy(QaAuthSession, { tokenDigest: digest(token) });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    if (session.superAdminId) {
      const admin = await this.database.manager.findOneBy(QaSuperAdmin, { id: session.superAdminId, active: true });
      if (!admin) throw new UnauthorizedException();
      return { user: { id: admin.id, email: admin.email, role: 'super_admin', accountType: 'super_admin' } };
    }
    const key = await this.authenticateSession(token);
    const member = await this.database.manager.findOneByOrFail(QaOrgMember, { keyId: key.id });
    const impersonator = session.impersonatedBySuperAdminId ? await this.database.manager.findOneBy(QaSuperAdmin, { id: session.impersonatedBySuperAdminId, active: true }) : null;
    const project = await this.database.manager.findOneBy(QaProject, { id: key.projectId });
    return { user: { id: member.id, email: member.email, role: key.role, projectId: key.projectId, accountType: 'organization', onboardingCompleted: Boolean(project?.onboardingCompletedAt), apps: await this.appsForMember(this.database.manager, member.email), ...(impersonator ? { impersonated: true, impersonatedBy: impersonator.email } : {}) } };
  }

  async selectApp(token: string | undefined, projectId: string) {
    if (!token || !/^qs_[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    return this.database.transaction(async manager => {
      const session = await manager.findOne(QaAuthSession, { where: { tokenDigest: digest(token) }, lock: { mode: 'pessimistic_write' } });
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.memberId || session.superAdminId) throw new UnauthorizedException();
      const current = await manager.findOneBy(QaOrgMember, { id: session.memberId, active: true });
      if (!current) throw new UnauthorizedException();
      const target = await manager.findOneBy(QaOrgMember, { projectId, email: current.email, active: true });
      if (!target) throw new ForbiddenException('You do not have access to that app');
      const key = await manager.findOneBy(ProjectKey, { id: target.keyId, projectId, revoked: false });
      if (!key || key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
      session.memberId = target.id;
      await manager.save(session);
      return { selected: projectId, apps: await this.appsForMember(manager, current.email) };
    });
  }

  async startImpersonation(superAdminId: string, memberId: string, projectId: string) {
    const member = await this.database.manager.findOneBy(QaOrgMember, { id: memberId, projectId, active: true });
    if (!member) throw new NotFoundException('Active organization user not found');
    const secret = 'qs_' + randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const session = await this.database.manager.save(this.database.manager.create(QaAuthSession, { memberId: member.id, superAdminId: null, impersonatedBySuperAdminId: superAdminId, tokenDigest: digest(secret), expiresAt, revokedAt: null }));
    const key = await this.database.manager.findOneBy(ProjectKey, { id: member.keyId, projectId });
    if (!key || key.revoked || key.expiresAt.getTime() <= Date.now()) { await this.database.manager.delete(QaAuthSession, { id: session.id }); throw new UnauthorizedException('User access is not active'); }
    return { token: secret, expiresAt, user: { id: member.id, email: member.email, role: key.role, projectId, accountType: 'organization', impersonated: true } };
  }

  async endImpersonation(currentToken: string | undefined, adminToken: string | undefined) {
    if (!currentToken || !/^qs_[a-f0-9]{64}$/.test(currentToken)) throw new UnauthorizedException();
    if (!adminToken || !/^qs_[a-f0-9]{64}$/.test(adminToken)) throw new UnauthorizedException();
    const current = await this.database.manager.findOneBy(QaAuthSession, { tokenDigest: digest(currentToken) });
    if (!current?.impersonatedBySuperAdminId || current.revokedAt || current.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('No active impersonation session');
    const member = current.memberId ? await this.database.manager.findOneBy(QaOrgMember, { id: current.memberId }) : null;
    if (!member) throw new UnauthorizedException('Impersonated user no longer exists');
    const admin = await this.database.manager.findOneBy(QaAuthSession, { tokenDigest: digest(adminToken), superAdminId: current.impersonatedBySuperAdminId, memberId: IsNull() });
    if (!admin || admin.revokedAt || admin.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Original admin session has expired');
    if (!await this.database.manager.findOneBy(QaSuperAdmin, { id: admin.superAdminId!, active: true })) throw new UnauthorizedException('Original admin account is inactive');
    await this.database.manager.update(QaAuthSession, { id: current.id }, { revokedAt: new Date() });
    return { expiresAt: admin.expiresAt, projectId: member!.projectId, memberId: member!.id, superAdminId: admin.superAdminId! };
  }

  async authenticateSuperAdminSession(token: string | undefined) {
    if (!token || !/^qs_[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const session = await this.database.manager.findOneBy(QaAuthSession, { tokenDigest: digest(token) });
    if (!session || !session.superAdminId || session.memberId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    const admin = await this.database.manager.findOneBy(QaSuperAdmin, { id: session.superAdminId, active: true });
    if (!admin) throw new UnauthorizedException();
    return admin;
  }

  async logout(token: string | undefined) {
    if (token && /^qs_[a-f0-9]{64}$/.test(token)) await this.database.manager.update(QaAuthSession, { tokenDigest: digest(token) }, { revokedAt: new Date() });
  }

  async invitationList(projectId: string) {
    return this.database.manager.find(QaOrgInvitation, { where: { projectId }, select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true } });
  }

  async memberList(projectId: string) {
    const members = await this.database.manager.find(QaOrgMember, { where: { projectId, active: true }, select: { id: true, email: true, keyId: true, createdAt: true } });
    return Promise.all(members.map(async member => ({ id: member.id, email: member.email, role: (await this.database.manager.findOneBy(ProjectKey, { id: member.keyId }))?.role, createdAt: member.createdAt })));
  }

  async revokeMember(projectId: string, id: string) {
    await this.database.transaction(async manager => {
      const member = await manager.findOne(QaOrgMember, { where: { id, projectId }, lock: { mode: 'pessimistic_write' } });
      if (!member) throw new NotFoundException();
      const key = await manager.findOneBy(ProjectKey, { id: member.keyId, projectId });
      if (key?.role === 'owner') {
        const activeOwners = await manager.count(ProjectKey, { where: { projectId, role: 'owner', revoked: false } });
        if (activeOwners <= 1) throw new ConflictException('Promote another admin or issue another owner credential before revoking the last admin');
      }
      member.active = false; member.tokenVersion += 1;
      await manager.save(member);
      await manager.update(ProjectKey, { id: member.keyId, projectId }, { revoked: true });
      await manager.update(QaAuthSession, { memberId: member.id, revokedAt: null }, { revokedAt: new Date() });
    });
    return { revoked: true };
  }

  async revokeInvitation(projectId: string, id: string) {
    const invite = await this.database.manager.findOneBy(QaOrgInvitation, { id, projectId });
    if (!invite) throw new NotFoundException();
    if (invite.acceptedAt) throw new ConflictException('This invitation has already been accepted; revoke the member account instead');
    if (!invite.revokedAt) { invite.revokedAt = new Date(); await this.database.manager.save(invite); await this.database.manager.update(ProjectKey, { id: invite.memberKeyId }, { revoked: true }); }
    return { revoked: true };
  }

  oidcEnabled() { return Boolean(process.env.OIDC_ISSUER_URL && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI); }

  private oidcConfig() {
    if (!this.oidcEnabled()) throw new NotFoundException('SSO is not configured');
    return { issuer: process.env.OIDC_ISSUER_URL!, clientId: process.env.OIDC_CLIENT_ID!, clientSecret: process.env.OIDC_CLIENT_SECRET!, redirectUri: process.env.OIDC_REDIRECT_URI! };
  }

  async startOidc() {
    const config = this.oidcConfig();
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(issuer.hostname)) throw new ForbiddenException('OIDC issuer must use HTTPS');
    const discoveryResponse = await fetch(new URL('.well-known/openid-configuration', issuer.toString().replace(/\/$/, '') + '/'), { cache: 'no-store' });
    if (!discoveryResponse.ok) throw new ServiceUnavailableException('OIDC provider discovery failed');
    const metadata = await discoveryResponse.json() as { issuer: string; authorization_endpoint: string };
    if (metadata.issuer !== issuer.toString().replace(/\/$/, '')) throw new ForbiddenException('OIDC issuer mismatch');
    const authorizationEndpoint = new URL(metadata.authorization_endpoint);
    if (authorizationEndpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(authorizationEndpoint.hostname)) throw new ForbiddenException('OIDC authorization endpoint must use HTTPS');
    const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
    await this.database.manager.save(this.database.manager.create(QaOidcAttempt, { stateDigest: digest(state), nonce, verifier, expiresAt: new Date(Date.now() + 5 * 60000) }));
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorization = authorizationEndpoint;
    authorization.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return { authorizationUrl: authorization.toString(), state };
  }

  async finishOidc(code: string, state: string) {
    if (!code || code.length > 4096 || !state || state.length > 256) throw new UnauthorizedException('Invalid SSO response');
    const config = this.oidcConfig();
    const stateDigest = digest(state);
    const attempt = await this.database.manager.findOneBy(QaOidcAttempt, { stateDigest });
    if (!attempt || attempt.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('SSO login expired; try again');
    await this.database.manager.delete(QaOidcAttempt, { id: attempt.id });
    const issuer = config.issuer.replace(/\/$/, '');
    const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
    if (!discoveryResponse.ok) throw new ServiceUnavailableException('OIDC provider discovery failed');
    const discovery = await discoveryResponse.json() as { issuer: string; token_endpoint: string; jwks_uri: string };
    if (discovery.issuer !== issuer) throw new ForbiddenException('OIDC issuer mismatch');
    for (const endpoint of [discovery.token_endpoint, discovery.jwks_uri]) {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new ForbiddenException('OIDC endpoints must use HTTPS');
    }
    const tokenResponse = await fetch(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, client_id: config.clientId, client_secret: config.clientSecret, code_verifier: attempt.verifier }), cache: 'no-store' });
    if (!tokenResponse.ok) throw new UnauthorizedException('SSO token exchange failed');
    const tokenSet = await tokenResponse.json() as { id_token?: string };
    if (!tokenSet.id_token) throw new UnauthorizedException('SSO identity token missing');
    const [headerPart, payloadPart, signaturePart] = tokenSet.id_token.split('.');
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as { alg: string; kid: string };
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as { iss: string; aud: string | string[]; azp?: string; sub: string; exp: number; iat: number; nonce: string; email: string; email_verified: boolean };
    const audienceValid = Array.isArray(claims.aud) ? claims.aud.includes(config.clientId) && (claims.aud.length === 1 || claims.azp === config.clientId) : claims.aud === config.clientId;
    if (header.alg !== 'RS256' || !header.kid || claims.iss !== issuer || !claims.sub || !audienceValid || claims.exp <= Date.now() / 1000 || claims.iat > Date.now() / 1000 + 60 || claims.nonce !== attempt.nonce || claims.email_verified !== true || !validEmail(claims.email)) throw new UnauthorizedException('SSO identity could not be verified');
    const jwks = await (await fetch(discovery.jwks_uri, { cache: 'no-store' })).json() as { keys: Array<JsonWebKey & { kid: string }> };
    const jwk = jwks.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk || !verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'))) throw new UnauthorizedException('SSO signature is invalid');
    const member = await this.database.manager.findOneBy(QaOrgMember, { email: normalizeEmail(claims.email), active: true });
    if (!member) throw new UnauthorizedException('No active invited account matches this SSO identity');
    return this.database.transaction(manager => this.createSession(manager, member));
  }
}

type JsonWebKey = import('crypto').JsonWebKey;
