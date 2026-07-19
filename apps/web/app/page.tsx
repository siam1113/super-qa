import { AppShell } from '../components/AppShell';
import { loadWorkspace } from '../lib/load-workspace';
export default async function HomePage() {
  const workspace = await loadWorkspace();
  return <AppShell initialWorkspace={workspace} />;
}
