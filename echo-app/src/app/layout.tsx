import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'Echo',
  description: '意识流 AI 写作伴生系统',
}

import { Toaster } from '@/components/ui/toaster'
import { SettingsProvider } from '@/lib/settings-context'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var k='echo-settings';try{var s=localStorage.getItem(k);var t='light',fs='medium';if(s){var p=JSON.parse(s);t=p.theme||'light';fs=p.fontSize||'medium';}var r=t==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);document.documentElement.setAttribute('data-font-size',fs);}catch(e){}})();`,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200;400;700&family=Inter:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-serif antialiased">
        <SettingsProvider>
          {children}
          <Toaster />
        </SettingsProvider>
      </body>
    </html>
  )
}
