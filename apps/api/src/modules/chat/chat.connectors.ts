import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'crypto';
import { DataSource, In } from 'typeorm';
import { ChatAgent, ChatChannel, ChatConversation, ChatDelivery, ChatInstallation, ChatMessage } from './chat.entity';
import { QaOrgMember } from '../autonomy/identity.entity';
import { ChatActor, ChatService, IncomingMessage } from './chat.service';
import { ExternalConversationDto, InstallationAccessDto, InstallationDto } from './chat.dto';
import { chatRoleKinds } from './chat.roles';

function sharedTeamsCredentials() {
  const appId = process.env.TEAMS_SHARED_APP_ID || '';
  const appSecret = process.env.TEAMS_SHARED_APP_SECRET || '';
  if (!/^[a-f0-9-]{36}$/i.test(appId) || appSecret.length < 10) throw new ServiceUnavailableException('Set TEAMS_SHARED_APP_ID and TEAMS_SHARED_APP_SECRET for the shared Teams app');
  return { appId, appSecret };
}

function teamsConsentRedirectUri() {
  return (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '') + '/api/chat-hooks/teams/consent';
}

const TEAMS_CONSENT_STATE_TTL_MS = 10 * 60 * 1000;

// Mirrors Slack's OAuth state: the installing admin's identity travels in a signed `state` param
// through Microsoft's own admin-consent redirect, so — like Slack — there is nothing to store or
// expire out-of-band, and no pairing code for the admin to copy between browser and Teams.
function signTeamsConsentState(actor: ChatActor) {
  const encoded = Buffer.from(JSON.stringify({ ...actor, expiresAt: Date.now() + TEAMS_CONSENT_STATE_TTL_MS })).toString('base64url');
  return encoded + '.' + createHmac('sha256', secretKey()).update(encoded).digest('base64url');
}

function verifyTeamsConsentState(state: string | undefined): ChatActor {
  try {
    const [encoded, signature] = (state || '').split('.');
    if (!encoded || !signature) throw new Error();
    const expected = createHmac('sha256', secretKey()).update(encoded).digest('base64url');
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error();
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (typeof payload.projectId !== 'string' || typeof payload.memberId !== 'string' || typeof payload.keyId !== 'string' || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) throw new Error();
    return { projectId: payload.projectId, memberId: payload.memberId, keyId: payload.keyId };
  } catch { throw new UnauthorizedException('This Teams install link is invalid or expired. Start over.'); }
}

// Mirrors sharedTeamsCredentials(): one organization-owned Slack app, distributed via Slack's own
// OAuth "Add to Slack" install flow — the same shape as Teams' admin-consent flow below (both
// redirects carry the installing browser's own session, so neither needs a manual connect code).
const SLACK_BOT_SCOPES = ['app_mentions:read', 'channels:history', 'channels:read', 'chat:write', 'groups:history', 'groups:read', 'im:history', 'im:read', 'mpim:history', 'mpim:read'];

function sharedSlackCredentials() {
  const clientId = process.env.SLACK_CLIENT_ID || '';
  const clientSecret = process.env.SLACK_CLIENT_SECRET || '';
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  if (!clientId || clientSecret.length < 10 || signingSecret.length < 10) throw new ServiceUnavailableException('Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET for the shared Slack app');
  return { clientId, clientSecret, signingSecret };
}

function slackRedirectUri() {
  return (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '') + '/api/chat-hooks/slack/oauth/callback';
}

const SLACK_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Stateless, like signTeamsConsentState() below: the installing admin's identity travels in a
// signed `state` param through Slack's own OAuth redirect, so there is nothing to store or expire
// out-of-band — the signature and embedded expiry are everything the callback needs to verify.
function signSlackOAuthState(actor: ChatActor) {
  const encoded = Buffer.from(JSON.stringify({ ...actor, expiresAt: Date.now() + SLACK_OAUTH_STATE_TTL_MS })).toString('base64url');
  return encoded + '.' + createHmac('sha256', secretKey()).update(encoded).digest('base64url');
}

function verifySlackOAuthState(state: string | undefined): ChatActor {
  try {
    const [encoded, signature] = (state || '').split('.');
    if (!encoded || !signature) throw new Error();
    const expected = createHmac('sha256', secretKey()).update(encoded).digest('base64url');
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error();
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (typeof payload.projectId !== 'string' || typeof payload.memberId !== 'string' || typeof payload.keyId !== 'string' || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) throw new Error();
    return { projectId: payload.projectId, memberId: payload.memberId, keyId: payload.keyId };
  } catch { throw new UnauthorizedException('This Slack install link is invalid or expired. Start over.'); }
}

type Credentials = { token: string; signingSecret?: string };
type SigningKey = { kid: string; kty: string; n: string; e: string; endorsements?: string[] };
type ProviderBody = Record<string, any>;

function secretKey() {
  const key = process.env.CHAT_SECRET_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new ServiceUnavailableException('Set CHAT_SECRET_KEY to a 32-byte hex encryption key');
  return Buffer.from(key, 'hex');
}

export function encryptCredentials(value: Credentials, scope: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), nonce);
  cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptCredentials(value: string, scope: string): Credentials {
  const [nonce, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), nonce);
  decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}

export function verifySlack(raw: Buffer | undefined, timestamp: string | undefined, signature: string | undefined, secret: string) {
  if (!raw || !timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) throw new UnauthorizedException('Invalid Slack signature');
  const expected = 'v0=' + createHmac('sha256', secret).update('v0:' + timestamp + ':').update(raw).digest('hex');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new UnauthorizedException('Invalid Slack signature');
}

export function teamsServiceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['smba.trafficmanager.net', 'smba.infra.teams.microsoft.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9/-]*$/.test(url.pathname)) throw new UnauthorizedException('Unsupported Teams service URL');
  return url;
}

// expectedTenantId is null only for the shared endpoint's not-yet-claimed-tenant path, where the
// tenant ID is exactly what we're about to learn rather than something to check against.
export function verifyTeamsToken(authorization: string | undefined, body: ProviderBody, expectedBotId: string, expectedTenantId: string | null, keys: SigningKey[]) {
  try {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 16000) throw new Error();
    const parts = authorization.slice(7).split('.');
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const key = keys.find(candidate => candidate.kid === header.kid && candidate.kty === 'RSA');
    const now = Date.now() / 1000;
    if (header.alg !== 'RS256' || !key || !key.endorsements?.includes('msteams') || claims.iss !== 'https://api.botframework.com' || claims.aud !== expectedBotId || !Number.isFinite(claims.exp) || !Number.isFinite(claims.nbf) || claims.exp < now || claims.nbf > now + 60 || claims.serviceurl !== body.serviceUrl && claims.serviceUrl !== body.serviceUrl || body.channelId !== 'msteams' || (expectedTenantId !== null && body.channelData?.tenant?.id !== expectedTenantId)) throw new Error();
    teamsServiceUrl(body.serviceUrl);
    if (!verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error();
  } catch { throw new UnauthorizedException('Invalid Teams activity authentication'); }
}

@Injectable()
export class ChatConnectors {
  private keys: SigningKey[] = [];
  private keysExpire = 0;
  constructor(private readonly database: DataSource, private readonly chat: ChatService) {}

  async json(url: string, options: RequestInit = {}): Promise<ProviderBody> {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ServiceUnavailableException('Provider request failed');
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new ServiceUnavailableException('Provider response too large');
    return JSON.parse(text);
  }

  async list(actor: ChatActor) {
    return this.chat.scoped(actor, async manager => {
      const installations = await manager.findBy(ChatInstallation, { projectId: actor.projectId, enabled: true });
      return Promise.all(installations.map(async installation => {
        const channels = await manager.findBy(ChatChannel, { installationId: installation.id });
        const conversations = await manager.find(ChatConversation, { where: { installationId: installation.id, archived: false } });
        const enabledChannels = new Set(conversations.map(conversation => conversation.externalId));
        return { ...installation, webhookPath: '/api/chat-hooks/' + installation.provider + '/' + installation.id, channels: channels.map(channel => ({ ...channel, enabled: enabledChannels.has(channel.externalId) })) };
      }));
    }, true);
  }

  async connect(actor: ChatActor, input: InstallationDto) {
    await this.chat.scoped(actor, async () => true, true);
    secretKey();
    let slackTeamName: string | undefined;
    try {
      if (input.provider === 'slack') {
        if (!input.signingSecret || !input.token.startsWith('xoxb-')) throw new BadRequestException('Slack bot token and signing secret required');
        const identity = await this.json('https://slack.com/api/auth.test', { headers: { Authorization: 'Bearer ' + input.token } });
        if (!identity.ok || identity.team_id !== input.providerId || identity.user_id !== input.botId) throw new BadRequestException('Slack workspace or bot ID does not match this token');
        slackTeamName = typeof identity.team === 'string' ? identity.team : undefined;
      } else {
        if (![input.providerId, input.botId].every(value => /^[a-f0-9-]{36}$/i.test(value))) throw new BadRequestException('Teams tenant and app IDs must be UUIDs');
        await this.teamsToken(input.providerId, input.botId, input.token);
      }
    } catch { throw new BadRequestException('Provider credentials could not be verified. Check the workspace/tenant, bot/app ID and secret.'); }
    await this.chat.directory(actor); // idempotent; guarantees the superqa ChatAgent row exists
    return this.chat.scoped(actor, async manager => {
      // Super QA is the sole identity for 3rd-party apps (text and calls alike) — it's the
      // one face the platform presents there. QAE/AUE stay available for in-app conversations.
      const superqa = await manager.findOneByOrFail(ChatAgent, { projectId: actor.projectId, kind: 'superqa' });
      const agentIds = [superqa.id];
      const existing = await manager.findOneBy(ChatInstallation, { provider: input.provider, providerId: input.providerId });
      if (existing && existing.projectId !== actor.projectId) throw new BadRequestException('This workspace or tenant already has a connection');
      const id = existing?.id || randomUUID();
      const name = input.name?.trim() || (input.provider === 'slack' ? slackTeamName || 'Slack' : 'Microsoft Teams · ' + input.providerId.slice(0, 8));
      await manager.save(manager.create(ChatInstallation, { id, projectId: actor.projectId, agentId: agentIds[0] || null, agentIds, provider: input.provider, accessMode: input.accessMode || 'read_reply', providerId: input.providerId, botId: input.botId, name, secret: encryptCredentials({ token: input.token, signingSecret: input.signingSecret }, actor.projectId + ':' + id) }));
      await manager.update(ChatInstallation, id, { enabled: true, accessMode: input.accessMode || 'read_reply' });
      if (existing) await manager.createQueryBuilder().update(ChatConversation).set({ agentId: agentIds[0] || null, agentIds, policyVersion: () => '"policyVersion" + 1' }).where('"installationId" = :id', { id }).execute();
      await this.chat.audit(manager, actor, 'installation.connected', { installationId: id, provider: input.provider });
      return manager.findOneByOrFail(ChatInstallation, { id });
    }, true);
  }

  async disconnect(actor: ChatActor, id: string) {
    return this.chat.scoped(actor, async manager => {
      const installation = await manager.findOneBy(ChatInstallation, { id, projectId: actor.projectId });
      if (!installation) throw new NotFoundException();
      await manager.update(ChatInstallation, id, { enabled: false, secret: '' });
      await manager.update(ChatConversation, { installationId: id }, { archived: true });
      await this.chat.audit(manager, actor, 'installation.disconnected', { installationId: id });
      return { disconnected: true };
    }, true);
  }

  /**
   * Owner-only reveal of a connected installation's stored credentials, so the edit
   * form can show the saved bot token/signing secret (masked, eye-icon revealable)
   * instead of asking the owner to blindly retype a secret they already set.
   */
  async revealSecret(actor: ChatActor, id: string) {
    return this.chat.scoped(actor, async manager => {
      const installation = await manager.getRepository(ChatInstallation).createQueryBuilder('installation')
        .addSelect('installation.secret')
        .where('installation.id = :id AND installation.projectId = :projectId', { id, projectId: actor.projectId })
        .getOne();
      if (!installation) throw new NotFoundException();
      const credentials = decryptCredentials(installation.secret, installation.projectId + ':' + installation.id);
      await this.chat.audit(manager, actor, 'installation.secret_revealed', { installationId: id });
      return { token: credentials.token, signingSecret: credentials.signingSecret || null };
    }, true);
  }

  async updateAccess(actor: ChatActor, id: string, input: InstallationAccessDto) {
    return this.chat.scoped(actor, async manager => {
      const installation = await manager.findOneBy(ChatInstallation, { id, projectId: actor.projectId });
      if (!installation) throw new NotFoundException();
      await manager.update(ChatInstallation, id, { accessMode: input.accessMode });
      await this.chat.audit(manager, actor, 'installation.access_updated', { installationId: id, accessMode: input.accessMode });
      return manager.findOneByOrFail(ChatInstallation, { id });
    }, true);
  }

  async bind(actor: ChatActor, id: string, input: ExternalConversationDto) {
    return this.chat.scoped(actor, async manager => {
      const installation = await manager.findOneBy(ChatInstallation, { id, projectId: actor.projectId, enabled: true });
      if (!installation || !await manager.findOneBy(ChatChannel, { installationId: id, externalId: input.externalId })) throw new BadRequestException('Send a message mentioning the bot in the provider first, then select the discovered conversation');
      const memberIds = [...new Set([actor.memberId, ...input.memberIds])];
      const agentIds = installation.agentIds?.length ? installation.agentIds : installation.agentId ? [installation.agentId] : [];
      await this.chat.validateParticipants(manager, actor.projectId, memberIds, agentIds);
      const existing = await manager.findOneBy(ChatConversation, { installationId: id, externalId: input.externalId });
      if (existing && !existing.archived) throw new BadRequestException('Conversation already connected');
      await this.chat.audit(manager, actor, 'channel.enabled', { installationId: id, externalId: input.externalId, memberIds });
      if (existing) return manager.save(Object.assign(existing, input, { archived: false, memberIds, agentId: agentIds[0] || null, agentIds, policyVersion: existing.policyVersion + 1, createdBy: actor.memberId }));
      return manager.save(manager.create(ChatConversation, { ...input, projectId: actor.projectId, kind: 'external', createdBy: actor.memberId, memberIds, installationId: id, agentId: agentIds[0] || null, agentIds, dedupKey: id + ':' + input.externalId }));
    }, true);
  }

  async installation(id: string, provider: 'slack' | 'teams') {
    const installation = await this.database.getRepository(ChatInstallation).createQueryBuilder('installation').addSelect('installation.secret').where('installation.id = :id AND installation.provider = :provider AND installation.enabled = true', { id, provider }).getOne();
    if (!installation) throw new NotFoundException();
    return installation;
  }

  private credentials(installation: ChatInstallation) { return decryptCredentials(installation.secret, installation.projectId + ':' + installation.id); }

  private async teamsSigningKeys() {
    if (Date.now() >= this.keysExpire) {
      const document = await this.json('https://login.botframework.com/v1/.well-known/keys');
      this.keys = document.keys; this.keysExpire = Date.now() + 3600000;
    }
    return this.keys;
  }

  // Owner-only, matching createSlackInstallUrl()'s privilege level: generates Microsoft's admin-consent
  // URL for the one shared, multi-tenant Teams app. Unlike a pairing code, there is nothing for the
  // admin to copy into Teams — the tenant ID simply arrives on the consent redirect back to us.
  async createTeamsConnectUrl(actor: ChatActor) {
    return this.chat.scoped(actor, async () => {
      secretKey(); const { appId } = sharedTeamsCredentials();
      const url = 'https://login.microsoftonline.com/organizations/adminconsent?' + new URLSearchParams({ client_id: appId, redirect_uri: teamsConsentRedirectUri(), state: signTeamsConsentState(actor) }).toString();
      return { url };
    }, true);
  }

  // Webhook-facing counterpart, called from the redirect Microsoft sends the installing admin's
  // browser back to after they grant org-wide admin consent. Unlike Slack's OAuth callback there is
  // no code to exchange for a token here — the consent itself is the event; the tenant ID that
  // granted it arrives as a query param, which is what ties this connection to a real Teams org.
  async completeTeamsConsent(query: { tenant?: unknown; admin_consent?: unknown; error?: unknown; error_description?: unknown; state?: unknown }) {
    const actor = verifyTeamsConsentState(typeof query.state === 'string' ? query.state : undefined);
    if (typeof query.error === 'string') throw new BadRequestException(typeof query.error_description === 'string' ? query.error_description : 'Microsoft Teams installation was cancelled.');
    if (query.admin_consent !== 'True' || typeof query.tenant !== 'string' || !/^[a-f0-9-]{36}$/i.test(query.tenant)) throw new BadRequestException('Microsoft did not confirm admin consent for this tenant.');
    const tenantId = query.tenant;
    secretKey(); const { appId, appSecret } = sharedTeamsCredentials();
    return this.chat.scoped(actor, async manager => {
      const superqa = await this.chat.ensureSuperqa(manager, actor.projectId);
      const agentIds = [superqa.id];
      const existing = await manager.findOneBy(ChatInstallation, { provider: 'teams', providerId: tenantId });
      if (existing && existing.projectId !== actor.projectId) throw new BadRequestException('This Microsoft tenant is already connected to a different organization');
      const id = existing?.id || randomUUID();
      await manager.save(manager.create(ChatInstallation, { id, projectId: actor.projectId, agentId: agentIds[0] || null, agentIds, provider: 'teams', accessMode: existing?.accessMode || 'read_reply', providerId: tenantId, botId: appId, name: 'Microsoft Teams', secret: encryptCredentials({ token: appSecret }, actor.projectId + ':' + id), enabled: true }));
      if (existing) await manager.createQueryBuilder().update(ChatConversation).set({ agentId: agentIds[0] || null, agentIds, policyVersion: () => '"policyVersion" + 1' }).where('"installationId" = :id', { id }).execute();
      await this.chat.audit(manager, actor, 'installation.connected', { installationId: id, provider: 'teams', via: 'admin_consent' });
      return manager.findOneByOrFail(ChatInstallation, { id });
    }, true);
  }

  // Owner-only, matching createTeamsConnectUrl()'s privilege level: generates the Slack "Add to
  // Slack" authorize URL, with the installing admin's identity carried in a signed state param.
  async createSlackInstallUrl(actor: ChatActor) {
    return this.chat.scoped(actor, async () => {
      secretKey();
      const { clientId } = sharedSlackCredentials();
      const url = 'https://slack.com/oauth/v2/authorize?' + new URLSearchParams({ client_id: clientId, scope: SLACK_BOT_SCOPES.join(','), redirect_uri: slackRedirectUri(), state: signSlackOAuthState(actor) }).toString();
      return { url };
    }, true);
  }

  // Webhook-facing counterpart, called from the OAuth redirect Slack sends the installing admin's
  // browser back to — the same shape as completeTeamsConsent() below, just with a code-for-token
  // exchange step first (admin consent has no equivalent exchange; the tenant ID simply arrives).
  async completeSlackInstall(code: string, state: string | undefined) {
    const actor = verifySlackOAuthState(state);
    secretKey();
    const { clientId, clientSecret, signingSecret } = sharedSlackCredentials();
    const exchange = await this.json('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: slackRedirectUri() }).toString() });
    if (!exchange.ok || typeof exchange.access_token !== 'string' || !exchange.access_token.startsWith('xoxb-') || typeof exchange.bot_user_id !== 'string' || typeof exchange.team?.id !== 'string') throw new BadRequestException('Slack did not return a valid bot installation');
    const teamId = exchange.team.id as string;
    const botId = exchange.bot_user_id as string;
    const name = typeof exchange.team.name === 'string' && exchange.team.name.trim() ? exchange.team.name.slice(0, 100) : 'Slack';
    return this.chat.scoped(actor, async manager => {
      const superqa = await this.chat.ensureSuperqa(manager, actor.projectId);
      const agentIds = [superqa.id];
      const existing = await manager.findOneBy(ChatInstallation, { provider: 'slack', providerId: teamId });
      if (existing && existing.projectId !== actor.projectId) throw new BadRequestException('This Slack workspace is already connected to a different organization');
      const id = existing?.id || randomUUID();
      await manager.save(manager.create(ChatInstallation, { id, projectId: actor.projectId, agentId: agentIds[0] || null, agentIds, provider: 'slack', accessMode: existing?.accessMode || 'read_reply', providerId: teamId, botId, name, secret: encryptCredentials({ token: exchange.access_token, signingSecret }, actor.projectId + ':' + id), enabled: true }));
      if (existing) await manager.createQueryBuilder().update(ChatConversation).set({ agentId: agentIds[0] || null, agentIds, policyVersion: () => '"policyVersion" + 1' }).where('"installationId" = :id', { id }).execute();
      await this.chat.audit(manager, actor, 'installation.connected', { installationId: id, provider: 'slack', via: 'oauth' });
      return manager.findOneByOrFail(ChatInstallation, { id });
    }, true);
  }

  async inbound(provider: 'slack' | 'teams', requestedId: string | null, body: ProviderBody, raw?: Buffer, headers: Record<string, string | string[] | undefined> = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid provider event');
    let installation: ChatInstallation;
    if (provider === 'teams' && requestedId === null) {
      const tenantId = body.channelData?.tenant?.id;
      const existing = typeof tenantId === 'string' ? await this.database.getRepository(ChatInstallation).createQueryBuilder('installation').addSelect('installation.secret').where('installation.providerId = :tenantId AND installation.provider = \'teams\' AND installation.enabled = true', { tenantId }).getOne() : null;
      if (!existing) {
        verifyTeamsToken(typeof headers.authorization === 'string' ? headers.authorization : undefined, body, sharedTeamsCredentials().appId, null, await this.teamsSigningKeys());
        return { ok: true }; // Not installed via admin consent (or since disconnected); nothing to deliver to.
      }
      installation = existing;
    } else if (provider === 'slack' && requestedId === null) {
      // Shared single Slack app: there is no per-installation secret to verify against yet (the
      // installation is resolved below, by team_id), so verify up front with the app's one static
      // signing secret instead — same role sharedTeamsCredentials()'s audience check plays above.
      const { signingSecret } = sharedSlackCredentials();
      verifySlack(raw, typeof headers['x-slack-request-timestamp'] === 'string' ? headers['x-slack-request-timestamp'] : undefined, typeof headers['x-slack-signature'] === 'string' ? headers['x-slack-signature'] : undefined, signingSecret);
      if (body.type === 'url_verification' && typeof body.challenge === 'string') return { challenge: body.challenge };
      if (typeof body.team_id !== 'string') return { ok: true };
      const existing = await this.database.getRepository(ChatInstallation).createQueryBuilder('installation').addSelect('installation.secret').where('installation.providerId = :teamId AND installation.provider = \'slack\' AND installation.enabled = true', { teamId: body.team_id }).getOne();
      if (!existing) return { ok: true }; // Not installed via OAuth (or since disconnected); nothing to deliver to.
      installation = existing;
    } else {
      installation = await this.installation(requestedId as string, provider);
    }
    const id = installation.id;
    const credentials = this.credentials(installation);
    let incoming: IncomingMessage | null = null;
    if (provider === 'slack') {
      verifySlack(raw, typeof headers['x-slack-request-timestamp'] === 'string' ? headers['x-slack-request-timestamp'] : undefined, typeof headers['x-slack-signature'] === 'string' ? headers['x-slack-signature'] : undefined, credentials.signingSecret || '');
      if (body.type === 'url_verification' && typeof body.challenge === 'string') return { challenge: body.challenge };
      if (body.team_id !== installation.providerId) throw new UnauthorizedException('Workspace mismatch');
      const event = body.event;
      if (['app_uninstalled', 'tokens_revoked'].includes(event?.type)) { await this.database.manager.update(ChatInstallation, id, { enabled: false, secret: '' }); return { ok: true }; }
      if (event?.type === 'member_left_channel' && event.user === installation.botId && typeof event.channel === 'string') { await this.database.manager.update(ChatConversation, { installationId: id, externalId: event.channel }, { archived: true }); return { ok: true }; }
      if (event && ['message', 'app_mention'].includes(event.type) && !event.subtype && !event.bot_id && event.user !== installation.botId && typeof event.text === 'string' && typeof event.channel === 'string' && typeof event.ts === 'string' && typeof event.user === 'string') {
        const installationAgentIds = installation.agentIds?.length ? installation.agentIds : installation.agentId ? [installation.agentId] : [];
        const mentionText = installationAgentIds.length === 1 ? '@' + (await this.database.manager.findOneByOrFail(ChatAgent, { id: installationAgentIds[0] })).name : '';
        incoming = { conversationId: event.channel, eventId: event.channel + ':' + event.ts, authorId: event.user, authorName: event.user, text: event.text.replaceAll('<@' + installation.botId + '>', mentionText), threadId: event.thread_ts || event.ts, mentioned: event.type === 'app_mention' || event.text.includes('<@' + installation.botId + '>') || event.channel_type === 'im' };
      }
    } else {
      verifyTeamsToken(typeof headers.authorization === 'string' ? headers.authorization : undefined, body, installation.botId, installation.providerId, await this.teamsSigningKeys());
      if (body.type === 'installationUpdate' && body.action === 'remove' && typeof body.conversation?.id === 'string') { await this.database.manager.update(ChatConversation, { installationId: id, externalId: body.conversation.id }, { archived: true }); return { ok: true }; }
      if (body.type === 'message' && typeof body.id === 'string' && typeof body.text === 'string' && typeof body.conversation?.id === 'string' && typeof body.from?.id === 'string' && body.from.id !== body.recipient?.id) {
        incoming = { conversationId: body.conversation.id, eventId: body.id, authorId: body.from.id, authorName: typeof body.from.name === 'string' ? body.from.name : body.from.id, text: body.text.replace(/<at>[^<]*<\/at>/g, '').trim(), threadId: body.replyToId || body.id, serviceUrl: body.serviceUrl, mentioned: body.conversation.conversationType === 'personal' || Array.isArray(body.entities) && body.entities.some((entity: ProviderBody) => entity?.type === 'mention' && entity.mentioned?.id === body.recipient?.id) };
      }
    }
    if (incoming?.text && incoming.conversationId.length <= 500 && incoming.eventId.length <= 600 && typeof incoming.threadId === 'string' && incoming.threadId.length <= 600 && incoming.text.length <= 8000) {
      const existingChannel = await this.database.manager.findOneBy(ChatChannel, { installationId: id, externalId: incoming.conversationId });
      // Resolve a human-readable name the first time this channel is seen — or retroactively, if an
      // earlier turn only had the raw thread/channel ID to fall back on — so steady-state messages
      // don't spend an extra provider API call (and Slack rate limit) on every turn.
      if (!existingChannel || existingChannel.name === incoming.conversationId) {
        let name = incoming.conversationId;
        if (provider === 'teams' && typeof body.conversation.name === 'string' && body.conversation.name.trim()) {
          name = body.conversation.name.slice(0, 100);
        } else if (provider === 'teams' && body.conversation.conversationType === 'personal') {
          // Teams never names a 1:1 chat; it displays the other participant's name instead, so match that.
          name = incoming.authorName.slice(0, 100);
        } else if (provider === 'teams') {
          try {
            const token = await this.teamsToken(installation.providerId, installation.botId, credentials.token);
            const base = teamsServiceUrl(incoming.serviceUrl || '').toString().replace(/\/$/, '');
            const members = await this.json(base + '/v3/conversations/' + encodeURIComponent(incoming.conversationId) + '/members', { headers: { Authorization: 'Bearer ' + token } }) as unknown as ProviderBody[];
            const names = Array.isArray(members) ? members.filter(member => member.id !== body.recipient?.id).map(member => typeof member.name === 'string' ? member.name.trim() : '').filter(Boolean) : [];
            if (names.length) name = names.join(', ').slice(0, 100);
          } catch { /* Fall back to the raw conversation ID if Teams' member lookup fails. */ }
        } else if (provider === 'slack') {
          try {
            const info = await this.json('https://slack.com/api/conversations.info?channel=' + encodeURIComponent(incoming.conversationId), { headers: { Authorization: 'Bearer ' + credentials.token } });
            if (info.ok && typeof info.channel?.name === 'string') name = info.channel.name.slice(0, 100);
          } catch { /* Fall back to the raw channel ID if Slack's lookup fails or is rate-limited. */ }
        }
        if (existingChannel) {
          if (name !== incoming.conversationId) {
            await this.database.manager.update(ChatChannel, { id: existingChannel.id }, { name });
            await this.database.manager.createQueryBuilder().update(ChatConversation).set({ title: name }).where('"installationId" = :id AND "externalId" = :externalId AND "title" = :raw', { id, externalId: incoming.conversationId, raw: incoming.conversationId }).execute();
          }
        } else {
          await this.database.manager.createQueryBuilder().insert().into(ChatChannel).values({ installationId: id, externalId: incoming.conversationId, name }).orIgnore().execute();
          // Teams has no "access status" step: the moment a conversation is discovered, every
          // active app member can see it — unlike Slack, which still gates on the manual Enable flow.
          if (provider === 'teams') {
            const members = await this.database.manager.find(QaOrgMember, { where: { projectId: installation.projectId, active: true }, order: { createdAt: 'ASC' } });
            if (members.length) {
              const agentIds = installation.agentIds?.length ? installation.agentIds : installation.agentId ? [installation.agentId] : [];
              await this.database.manager.createQueryBuilder().insert().into(ChatConversation).values({
                projectId: installation.projectId,
                kind: 'external',
                title: name,
                createdBy: members[0].id,
                memberIds: members.map(member => member.id),
                installationId: id,
                externalId: incoming.conversationId,
                agentId: agentIds[0] || null,
                agentIds,
                dedupKey: id + ':' + incoming.conversationId,
              }).orIgnore().execute();
            }
          }
        }
      }
      await this.chat.receive(installation, incoming);
    }
    return { ok: true };
  }

  async teamsToken(tenant: string, appId: string, secret: string) {
    const response = await this.json('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: appId, client_secret: secret, scope: 'https://api.botframework.com/.default' }).toString() });
    if (typeof response.access_token !== 'string') throw new Error('Teams token unavailable');
    return response.access_token;
  }

  async deliverOne(): Promise<boolean> {
    const delivery = await this.database.transaction(async manager => {
      await manager.createQueryBuilder().update(ChatDelivery).set({ status: 'uncertain' }).where("status = 'sending' AND \"startedAt\" < :cutoff", { cutoff: new Date(Date.now() - 60000) }).execute();
      const next = await manager.getRepository(ChatDelivery).createQueryBuilder('delivery').setLock('pessimistic_write').setOnLocked('skip_locked').where("delivery.status = 'waiting'").andWhere('EXISTS (SELECT 1 FROM chat_messages message WHERE message.id = delivery."messageId" AND message.status IN (:...statuses))', { statuses: ['sent', 'failed'] }).orderBy('delivery.createdAt', 'ASC').getOne();
      if (!next) return null;
      next.status = 'sending'; next.startedAt = new Date();
      return manager.save(next);
    });
    if (!delivery) return false;
    let attempted = false;
    try {
      const message = await this.database.manager.findOneByOrFail(ChatMessage, { id: delivery.messageId, status: 'sent' });
      const publicInstallation = await this.database.manager.findOneByOrFail(ChatInstallation, { id: delivery.installationId, enabled: true });
      const installation = await this.installation(publicInstallation.id, publicInstallation.provider);
      if (installation.accessMode === 'read_only') throw new Error('Reply permission disabled');
      const conversation = await this.database.manager.findOneBy(ChatConversation, { id: message.conversationId, installationId: installation.id, archived: false });
      const installationAgentIds = installation.agentIds?.length ? installation.agentIds : installation.agentId ? [installation.agentId] : [];
      if (!conversation || !installationAgentIds.length || !await this.database.manager.findOneBy(ChatAgent, { id: In(installationAgentIds), enabled: true, kind: In(chatRoleKinds) })) throw new Error('Delivery access revoked');
      const credentials = this.credentials(installation);
      const text = installationAgentIds.length > 1 && message.authorKind === 'agent' ? message.authorName + ': ' + message.text : message.text;
      let result: ProviderBody;
      if (installation.provider === 'slack') {
        attempted = true;
        result = await this.json('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: delivery.address.conversationId, thread_ts: delivery.address.threadId, text, mrkdwn: false, unfurl_links: false, unfurl_media: false, client_msg_id: delivery.id }) });
        if (!result.ok || typeof result.ts !== 'string') throw new Error('Slack rejected delivery');
      } else {
        const token = await this.teamsToken(installation.providerId, installation.botId, credentials.token);
        const base = teamsServiceUrl(delivery.address.serviceUrl || '').toString().replace(/\/$/, '');
        attempted = true;
        result = await this.json(base + '/v3/conversations/' + encodeURIComponent(delivery.address.conversationId) + '/activities/' + encodeURIComponent(delivery.address.threadId), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'message', textFormat: 'plain', text }) });
        if (typeof result.id !== 'string') throw new Error('Teams rejected delivery');
      }
      await this.database.manager.update(ChatDelivery, { id: delivery.id, status: 'sending' }, { status: 'sent', externalId: result.ts || result.id });
    } catch {
      await this.database.manager.update(ChatDelivery, { id: delivery.id, status: 'sending' }, { status: attempted ? 'uncertain' : 'failed' });
    }
    return true;
  }
}
