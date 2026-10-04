import { getScanPaths } from '@/lib/capacitorScanner';
import { shouldRecurseInto } from '@/lib/maxymoScanner';
import { describe, expect, it } from 'vitest';

describe('getScanPaths', () => {
  it('always includes the standard screenshot folders regardless of capture method', () => {
    const paths = getScanPaths();
    expect(paths).toContain('Pictures/Screenshots');
    expect(paths).toContain('Pictures/Lyft');
    // Field-confirmed (adb-pulled 2026-09-24): Maxymo writes to lowercase Pictures/maxymo/lyft.
    expect(paths).toContain('Pictures/maxymo/lyft');
  });
});

describe('shouldRecurseInto', () => {
  it('recurses into known screenshot-ish subfolder names', () => {
    expect(shouldRecurseInto('Screenshots')).toBe(true);
    expect(shouldRecurseInto('maxymo')).toBe(true);
    expect(shouldRecurseInto('Lyft')).toBe(true);
  });

  it('does not recurse into unrelated subfolders', () => {
    expect(shouldRecurseInto('Camera')).toBe(false);
    expect(shouldRecurseInto('WhatsApp Images')).toBe(false);
  });
});
