import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AcceptInvitationDto, CreateOrganizationDto, InviteMemberDto, LoginDto, OrganizationSupportSettingsDto, ProjectSettingsDto, SelectAppDto } from './autonomy.dto';
import { ProjectGuard } from './autonomy.controller';
import { ProjectKey } from './autonomy.entity';
import { AutonomyService } from './autonomy.service';
import { Throttle } from '@nestjs/throttler';

const cookieName = 'qa_session';
const sessionCookie = (token: string, maxAge: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const adminSessionCookie = (token: string, maxAge: number) => `qa_admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const oidcStateCookie = (token: string, maxAge: number) => `qa_oidc_state=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const sessionToken = (request: Request) => (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
const adminSessionToken = (request: Request) => (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('qa_admin_session='))?.slice('qa_admin_session='.length);
const oidcState = (request: Request) => (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('qa_oidc_state='))?.slice('qa_oidc_state='.length);

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { superAdmin: unknown }>();
    request.superAdmin = await this.auth.authenticateSuperAdminSession(sessionToken(request));
    return true;
  }
}

@Controller('auth')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly autonomy: AutonomyService) {}

  @Get('config') config() { return { ssoEnabled: this.auth.oidcEnabled() }; }

  @Post('login') @Throttle({ default: { limit: 10, ttl: 60000 } }) async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.login(input.email, input.password);
    response.setHeader('Set-Cookie', sessionCookie(session.token, 8 * 3600));
    return { user: session.user };
  }

  @Post('accept-invitation') @Throttle({ default: { limit: 10, ttl: 60000 } }) async accept(@Body() input: AcceptInvitationDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.acceptInvitation(input.token, input.password);
    response.setHeader('Set-Cookie', sessionCookie(session.token, 8 * 3600));
    return { user: session.user };
  }

  @Get('session') async session(@Req() request: Request) { return this.auth.session(sessionToken(request)); }

  @Post('select-app') selectApp(@Req() request: Request, @Body() input: SelectAppDto) { return this.auth.selectApp(sessionToken(request), input.projectId); }

  @Get('organization-admin') @UseGuards(ProjectGuard)
  organizationAdminSettings(@Req() request: Request & { projectKey: ProjectKey }) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage organization settings');
    return this.autonomy.organizationForAdmin(request.projectKey.projectId);
  }

  @Post('organization-admin/apps') @UseGuards(ProjectGuard)
  createAppForOrganizationAdmin(@Req() request: Request & { projectKey: ProjectKey }, @Body() input: CreateOrganizationDto) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can add apps');
    return this.autonomy.createOrganizationAppForAdmin(request.projectKey.projectId, input, `organization-admin:${request.projectKey.label}`);
  }

  @Patch('organization-admin/apps/:appId/settings') @UseGuards(ProjectGuard)
  updateAppForOrganizationAdmin(@Req() request: Request & { projectKey: ProjectKey }, @Param('appId', ParseUUIDPipe) appId: string, @Body() input: ProjectSettingsDto) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage settings across the organization');
    return this.autonomy.updateOrganizationSettingsForAdmin(request.projectKey.projectId, appId, input, `organization-admin:${request.projectKey.label}`);
  }

  @Post('organization-admin/apps/:appId/invitations') @UseGuards(ProjectGuard)
  inviteAppMemberForOrganizationAdmin(@Req() request: Request & { projectKey: ProjectKey }, @Param('appId', ParseUUIDPipe) appId: string, @Body() input: InviteMemberDto) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can invite app users');
    return this.autonomy.inviteAppMemberForAdmin(request.projectKey.projectId, appId, input.email, input.role, `organization-admin:${request.projectKey.label}`);
  }

  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(sessionToken(request));
    response.setHeader('Set-Cookie', [sessionCookie('', 0), adminSessionCookie('', 0)]);
    return { loggedOut: true };
  }

  @Get('super-admin/organizations') @UseGuards(SuperAdminGuard)
  organizations() { return this.autonomy.organizationList(); }

  @Post('super-admin/organizations') @UseGuards(SuperAdminGuard)
  createOrganization(@Body() input: CreateOrganizationDto) { return this.autonomy.enroll(input); }

  @Post('super-admin/organizations/:id/apps') @UseGuards(SuperAdminGuard)
  createOrganizationApp(@Param('id', ParseUUIDPipe) id: string, @Body() input: CreateOrganizationDto) { return this.autonomy.enroll({ ...input, organizationId: id }); }

  @Patch('super-admin/organizations/:organizationId/apps/:appId/settings') @UseGuards(SuperAdminGuard)
  updateOrganizationAppSettings(@Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('appId', ParseUUIDPipe) appId: string, @Body() input: ProjectSettingsDto) { return this.autonomy.updateOrganizationSettings(organizationId, appId, input); }

  @Post('super-admin/organizations/:organizationId/apps/:appId/invitations') @UseGuards(SuperAdminGuard)
  inviteOrganizationAppMember(@Req() request: Request & { superAdmin: { id: string; email: string } }, @Param('organizationId', ParseUUIDPipe) organizationId: string, @Param('appId', ParseUUIDPipe) appId: string, @Body() input: InviteMemberDto) {
    return this.autonomy.inviteAppMember(organizationId, appId, input.email, input.role, `super-admin:${request.superAdmin.email}`);
  }

  @Post('super-admin/organizations/:id/recover-owner') @UseGuards(SuperAdminGuard)
  recoverOwner(@Param('id', ParseUUIDPipe) id: string) { return this.autonomy.recoverOwner(id); }

  @Get('super-admin/organizations/:id/support-settings') @UseGuards(SuperAdminGuard)
  organizationSupportSettings(@Param('id', ParseUUIDPipe) id: string) { return this.autonomy.organizationSupportSettings(id); }

  @Patch('super-admin/organizations/:id/support-settings') @UseGuards(SuperAdminGuard)
  updateOrganizationSupportSettings(@Param('id', ParseUUIDPipe) id: string, @Body() input: OrganizationSupportSettingsDto) { return this.autonomy.updateOrganizationSupportSettings(id, input); }

  @Post('super-admin/organizations/:id/invitations') @UseGuards(SuperAdminGuard)
  inviteOrganizationMember(@Req() request: Request & { superAdmin: { id: string; email: string } }, @Param('id', ParseUUIDPipe) id: string, @Body() input: InviteMemberDto) {
    return this.autonomy.inviteOrganizationMember(id, input.email, input.role, request.superAdmin as import('./identity.entity').QaSuperAdmin);
  }

  @Post('super-admin/organizations/:id/members/:memberId/impersonate') @UseGuards(SuperAdminGuard)
  async impersonateMember(@Req() request: Request & { superAdmin: { id: string; email: string } }, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Res({ passthrough: true }) response: Response) {
    const originalToken = sessionToken(request);
    if (!originalToken) throw new ForbiddenException('Admin session is missing');
    const session = await this.autonomy.startMemberImpersonation(id, memberId, request.superAdmin as import('./identity.entity').QaSuperAdmin);
    response.setHeader('Set-Cookie', [sessionCookie(session.token, 15 * 60), adminSessionCookie(originalToken, 8 * 3600)]);
    return { user: session.user, expiresAt: session.expiresAt };
  }

  @Post('end-impersonation') async endImpersonation(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const adminToken = adminSessionToken(request);
    const currentToken = sessionToken(request);
    const result = await this.auth.endImpersonation(currentToken, adminToken);
    await this.autonomy.recordImpersonationEnded(result.projectId, result.memberId, result.superAdminId);
    const maxAge = Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
    response.setHeader('Set-Cookie', [sessionCookie(adminToken!, maxAge), adminSessionCookie('', 0)]);
    return { restored: true };
  }

  @Get('oidc/start') async oidcStart(@Res() response: Response) {
    const flow = await this.auth.startOidc();
    response.setHeader('Set-Cookie', oidcStateCookie(flow.state, 300));
    return response.redirect(302, flow.authorizationUrl);
  }

  @Get('oidc/callback') async oidcCallback(@Req() request: Request, @Query('code') code: string, @Query('state') state: string, @Res() response: Response) {
    if (!state || state !== oidcState(request)) throw new ForbiddenException('SSO state does not match this browser session');
    const session = await this.auth.finishOidc(code, state);
    response.setHeader('Set-Cookie', [sessionCookie(session.token, 8 * 3600), oidcStateCookie('', 0)]);
    return response.redirect(302, `${(process.env.AUTH_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/settings`);
  }

  @Post('invitations') @UseGuards(ProjectGuard)
  invite(@Req() request: Request & { projectKey: ProjectKey }, @Body() input: InviteMemberDto) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can invite members');
    return this.auth.invite(request.projectKey.projectId, input.email, input.role, request.projectKey.id);
  }

  @Get('invitations') @UseGuards(ProjectGuard)
  invitations(@Req() request: Request & { projectKey: ProjectKey }) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage invitations');
    return this.auth.invitationList(request.projectKey.projectId);
  }

  @Get('members') @UseGuards(ProjectGuard)
  members(@Req() request: Request & { projectKey: ProjectKey }) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage members');
    return this.auth.memberList(request.projectKey.projectId);
  }

  @Post('members/:id/revoke') @UseGuards(ProjectGuard)
  revokeMember(@Req() request: Request & { projectKey: ProjectKey }, @Param('id') id: string) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage members');
    return this.auth.revokeMember(request.projectKey.projectId, id);
  }

  @Post('invitations/:id/revoke') @UseGuards(ProjectGuard)
  revokeInvitation(@Req() request: Request & { projectKey: ProjectKey }, @Param('id') id: string) {
    if (request.projectKey.role !== 'owner') throw new ForbiddenException('Only an app Owner can manage invitations');
    return this.auth.revokeInvitation(request.projectKey.projectId, id);
  }
}
