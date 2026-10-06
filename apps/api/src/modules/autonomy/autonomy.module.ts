import { WorkflowArtifact } from "./workflow-artifact.entity";
import { WorkflowArtifactController } from "./workflow-artifact.controller";
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HarnessModule } from '../harness/harness.module';
import { AutonomousRun, AutonomousSuite, ProjectKey, QaAuditEvent, QaOrganization, QaProject } from './autonomy.entity';
import { AutonomyService } from './autonomy.service';
import { AutonomyController, ProjectGuard } from './autonomy.controller';
import { QaBenchmark } from './benchmark.entity';
import { QaAuthSession, QaOidcAttempt, QaOrgInvitation, QaOrgMember, QaSuperAdmin } from './identity.entity';
import { AuthService } from './auth.service';
import { AuthController, SuperAdminGuard } from './auth.controller';
import { ChatAgent, ChatInstallation } from '../chat/chat.entity';
import { QaOrgSupportSettings } from './org-support-settings.entity';

@Module({ imports: [HarnessModule, TypeOrmModule.forFeature([WorkflowArtifact, QaOrganization, QaProject, ProjectKey, AutonomousSuite, AutonomousRun, QaAuditEvent, QaBenchmark, QaOrgMember, QaOrgInvitation, QaAuthSession, QaOidcAttempt, QaSuperAdmin, ChatAgent, ChatInstallation, QaOrgSupportSettings])], controllers: [AutonomyController, AuthController, WorkflowArtifactController], providers: [AutonomyService, ProjectGuard, AuthService, SuperAdminGuard], exports: [AuthService, AutonomyService, ProjectGuard, SuperAdminGuard] })
export class AutonomyModule {}
