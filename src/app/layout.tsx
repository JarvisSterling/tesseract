import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Tesseract | Multi-Dimensional Crypto Analysis',
  description: 'See the market across all dimensions. Multi-timeframe EMA analysis for crypto trading.',
  keywords: ['crypto', 'trading', 'EMA', 'technical analysis', 'bitcoin', 'ethereum'],
  authors: [{ name: 'Tesseract' }],
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: 'Tesseract',
    description: 'Multi-Dimensional Crypto Analysis',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased bg-zinc-950 text-white`}>
        {children}
      </body>
    </html>
  );
}
