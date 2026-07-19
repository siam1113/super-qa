import { Controller, Get } from '@nestjs/common';
@Controller('integrations')
export class IntegrationsController { @Get() listIntegrations() { return ['GitHub','Jira','Zephyr','Confluence','Notion','Azure DevOps','GitLab','Bitbucket','Postman','Swagger','Playwright','Cypress','Selenium','REST APIs','GraphQL','Database'].map((name, index) => ({ name, status: index === 2 ? 'Warning' : 'Connected', lastSync: `${index + 8} min ago` })); } }
