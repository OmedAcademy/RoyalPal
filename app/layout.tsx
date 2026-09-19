import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Editorial display serif for hero + section headings (quiet-luxury feel).
const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://royalpal.app";

export const metadata: Metadata = {
  // metadataBase is what turns every relative Open Graph image and canonical
  // path below into an absolute URL. Without it Next emits a build warning and
  // social cards silently fall back to no image, which is the kind of thing
  // nobody notices until a link has already been shared.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "RoyalPal — find a tutor, book a lesson",
    // Pages set only their own name; the suffix is added here so it cannot
    // drift page by page.
    template: "%s · RoyalPal",
  },
  description:
    "RoyalPal connects students with verified tutors worldwide. Browse profiles, check real availability, and book a lesson in minutes.",
  applicationName: "RoyalPal",
  keywords: ["tutoring", "online tutor", "language lessons", "book a tutor", "private lessons"],
  authors: [{ name: "RoyalPal" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "RoyalPal",
    title: "RoyalPal — find a tutor, book a lesson",
    description:
      "Browse verified tutors, check real availability, and book a lesson in minutes. Teach Without Borders. Learn Without Limits.",
    url: SITE_URL,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: "RoyalPal — find a tutor, book a lesson",
    description: "Browse verified tutors, check real availability, and book a lesson in minutes.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Not `user-scalable=no`. Blocking zoom is an accessibility failure and a
  // WCAG violation, and it is the single most common mobile-web mistake.
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F5EE" },
    { media: "(prefers-color-scheme: dark)", color: "#12233D" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
