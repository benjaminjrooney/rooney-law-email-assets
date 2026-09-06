import type { Metadata } from "next";
import { Inter, Noto_Serif } from "next/font/google";
import "./globals.css";

/*
 * The firm's typefaces, per the Brand Kit's Typography Specification: Noto
 * Serif for display, Inter for body. Both are SIL Open Font License. They are
 * self-hosted by next/font — fetched at build time and served from this origin,
 * so no request leaves the browser for a font and the internal tool does not
 * announce itself to a third party.
 */
const notoSerif = Noto_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-noto-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Illinois Community Associations · Rooney Law",
    template: "%s · Rooney Law",
  },
  description:
    "Internal market-analysis database of Illinois community associations and their registered agents.",
  // A private internal tool: keep it out of search indexes.
  robots: { index: false, follow: false },
  /*
   * No `icons` entry: src/app/icon.png and src/app/apple-icon.png are picked up
   * by Next's file convention, which reads each file's real dimensions and emits
   * the right `sizes`. Both are the Brand Kit's square mark, byte for byte —
   * rooney-law-favicon-dark-512x512.png and -180x180.png.
   *
   * The dark variant, for the reason brand.json gives for choosing it as the
   * Windows icon: it carries its own charcoal ground, so it reads on a light or
   * a dark browser chrome without a second file.
   */
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${notoSerif.variable} ${inter.variable}`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
