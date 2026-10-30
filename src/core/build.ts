/**
 * Which build is running ("abc1234 2026-10-30 21:05Z"): the PWA defers
 * updates, so a phone can be a build or two behind what was pushed. Guarded
 * for anything that runs this without Vite's define.
 */
export const BUILD_ID: string = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
