import { AppShell } from '../components/AppShell';
import { seedWorkspace } from '../lib/seed-data';
export default function HomePage() { return <AppShell initialWorkspace={seedWorkspace} />; }
