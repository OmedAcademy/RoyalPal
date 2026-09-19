import type { MetadataRoute } from "next";
import { LEGAL_ROUTES } from "@/lib/constants/legal";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://royalpal.app";

/**
 * The public pages, and only those.
 *
 * Tutor profiles are deliberately NOT listed. They live behind
 * /student/tutors/[id], which requires a signed-in student — so every URL
 * would be a redirect to a sign-in page, which is worse for a crawler than
 * being absent. Publishing tutor profiles for search is a real growth move and
 * a real decision: it means a public, unauthenticated profile route, and a
 * privacy position on what of a tutor's information is indexable. That belongs
 * in its own change, with the privacy policy updated alongside it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE_URL}/our-impact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...Object.values(LEGAL_ROUTES).map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
