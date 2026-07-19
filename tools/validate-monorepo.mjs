import { existsSync, readFileSync, statSync } from 'node:fs';
const required = [
  'apps/web/app/page.tsx',
  'apps/web/components/AppShell.tsx',
  'apps/web/components/screens.tsx',
  'apps/web/app/globals.css',
  'apps/api/src/app.module.ts',
  'apps/api/src/database/mongodb.module.ts',
  'apps/api/src/modules/qa/schemas.ts',
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
  if (statSync(file).size === 0) throw new Error(`${file} is empty`);
}
const web = readFileSync('apps/web/components/AppShell.tsx', 'utf8') + readFileSync('apps/web/components/screens.tsx', 'utf8');
for (const token of ['RightInspector', 'CommandPalette', 'AICopilot', 'Healer', 'Knowledge Graph', 'Coverage Analysis', 'Data Setup']) {
  if (!web.includes(token)) throw new Error(`Missing UI token ${token}`);
}
const api = readFileSync('apps/api/src/modules/qa/schemas.ts', 'utf8') + readFileSync('apps/api/src/modules/qa/qa.controller.ts', 'utf8');
for (const token of ['TestCase', 'Execution', 'Fact', 'Flow', 'Action', 'DomSnapshot', 'DataSetup']) {
  if (!api.includes(token)) throw new Error(`Missing API model ${token}`);
}
console.log('Monorepo structure validation passed.');
