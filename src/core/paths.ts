/**
 * Where files from public/ live. The game is served from the site root in
 * development and from a sub-path in production (deeek.org/curbside/), so
 * never hard-code '/assets/...': ask for publicUrl('assets/...').
 */
export function publicUrl(path: string): string {
  return import.meta.env.BASE_URL + path;
}
