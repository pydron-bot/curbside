/**
 * The running version, from package.json (vite.config.ts `define`), so the
 * title, pause card and settings show it without loading the changelog.
 * tests/changelog.test.ts checks it matches the changelog's newest entry.
 */
export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
