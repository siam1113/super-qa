import { readFileSync, statSync } from 'node:fs';
const required = ['index.html', 'src/styles.css', 'src/main.js'];
for (const file of required) {
  const stat = statSync(file);
  if (!stat.size) throw new Error(`${file} is empty`);
}
const html = readFileSync('index.html', 'utf8');
const js = readFileSync('src/main.js', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');
for (const token of ['app-shell', 'left-sidebar', 'right-inspector', 'command-palette', 'ai-copilot']) {
  if (!html.includes(token) && !js.includes(token)) throw new Error(`Missing ${token}`);
}
for (const token of ['Dashboard', 'Executor', 'Healer', 'Context Manager', 'Test Cases', 'Knowledge Graph']) {
  if (!js.includes(token) && !html.includes(token)) throw new Error(`Missing UI copy: ${token}`);
}
if (!css.includes('@media')) throw new Error('Missing responsive media queries');
console.log('Static UI validation passed.');
