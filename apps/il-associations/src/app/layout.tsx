import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Illinois Community Associations",
  description:
    "Internal market-analysis database of Illinois community associations and their registered agents.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
