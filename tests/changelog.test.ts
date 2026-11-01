import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, VERSION, compareVersions } from '../src/core/changelog';

describe('changelog', () => {
  it('the version is the newest release, and package.json agrees', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION).toBe(CHANGELOG[0].version);
    expect(pkg.version).toBe(VERSION);
  });

  it('releases run newest first, each a well-formed version, date and some notes', () => {
    for (const [i, r] of CHANGELOG.entries()) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.notes.length).toBeGreaterThan(0);
      const older = CHANGELOG[i + 1];
      if (older) {
        expect(compareVersions(r.version, older.version)).toBeGreaterThan(0);
        expect(r.date >= older.date).toBe(true);
      }
    }
  });

  it('compares versions number by number', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.11.3')).toBeGreaterThan(0);
    expect(compareVersions('0.9.1', '0.9.1')).toBe(0);
  });
});
