// Scans all .mdx files under /events/ and builds the map automatically
const allPages = import.meta.glob('/src/content/docs/events/**/*.mdx');

export function buildTranslationsMap() {
  const map = {};

  for (const path of Object.keys(allPages)) {
    // Matches: /src/content/docs/events/en/some/nested/page.mdx
    const match = path.match(/\/src\/content\/docs\/events\/([^/]+)\/(.+)\.mdx$/);
    if (!match) continue;

    const lang = match[1];
    const slug = match[2];
    const url = `/events/${lang}/${slug}`;

    if (!map[slug]) map[slug] = {};
    map[slug][lang] = url;
  }

  return map;
}