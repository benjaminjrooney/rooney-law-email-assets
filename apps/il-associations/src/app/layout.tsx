import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Illinois Community Associations · Rooney Law",
    template: "%s · Rooney Law",
  },
  description:
    "Internal market-analysis database of Illinois community associations and their registered agents.",
  // A private internal tool: keep it out of search indexes.
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
