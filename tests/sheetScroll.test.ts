import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// gestures.ts cancels every touch drag outside [data-scroll], so a sheet's
// list without it can't be scrolled on a phone (the observe palette's last
// row was out of reach at 852x393).
const NO_LIST = new Set(['characterPicker.ts', 'teleportMap.ts']);

describe('sheet bodies', () => {
  it('scroll on touch: every sheet-body in markup carries data-scroll', () => {
    const dir = join(__dirname, '../src/ui');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !NO_LIST.has(n))) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (/class="sheet-body[^"]*"/.test(line) && !line.includes('data-scroll')) missing.push(`${f}: ${line.trim()}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
