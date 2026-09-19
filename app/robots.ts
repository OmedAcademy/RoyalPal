import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://royalpal.app";

/**
 * Only the public surface is crawlable.
 *
 * The disallow list is not about ranking — it is about not putting signed-in
 * URLs into a search index. /student, /tutor and /admin are all behind
 * middleware, so a crawler gets a redirect rather than content, but a URL in
 * an index is still an invitation and /api/* in particular is noise at best.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/legal/"],
        disallow: [
          "/api/",
          "/admin",
          "/student",
          "/tutor",
          "/messages",
          "/settings",
          "/support",
          "/suspended",
          "/auth/",
          "/reset-password",
          "/forgot-password",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
