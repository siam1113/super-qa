import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'superqa',
  description: 'AI-native QA Automation Platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
