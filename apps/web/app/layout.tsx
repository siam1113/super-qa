import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Ultimate AI QA Master Agent', description: 'AI-native QA automation platform' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
