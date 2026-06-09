import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GeoSports Dash',
  description: 'Enhanced leaderboard and stats for your GeoSports group',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
