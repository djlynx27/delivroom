import { getScanPaths } from '@/lib/capacitorScanner';
import { shouldRecurseInto } from '@/lib/maxymoScanner';
import { describe, expect, it } from 'vitest';

describe('getScanPaths', () => {
  it('always includes the standard screenshot folders regardless of capture method', () => {
    const paths = getScanPaths(null);
    expect(paths).toContain('Pictures/Screenshots');
    expect(paths).toContain('Pictures/Lyft');
    expect(paths).toContain('Pictures/Maxymo');
  });

  it('includes the user-configured path alongside the defaults, without duplicating it', () => {
    const paths = getScanPaths('Pictures/Maxymo');
    expect(paths.filter((p) => p === 'Pictures/Maxymo')).toHaveLength(1);
  });

  it('adds a custom configured path not already in the default list', () => {
    const paths = getScanPaths('Pictures/CustomFolder');
    expect(paths).toContain('Pictures/CustomFolder');
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
