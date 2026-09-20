import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readdir, readFile } = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { ExternalStorage: 'EXTERNAL_STORAGE' },
  Filesystem: { readdir, readFile },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));

vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
vi.mock('@capacitor/background-runner', () => ({
  BackgroundRunner: { dispatchEvent: vi.fn() },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    schedule: vi.fn(),
  },
}));

const { findExistingFileNames } = vi.hoisted(() => ({
  findExistingFileNames: vi.fn(),
}));
vi.mock('@/lib/screenshotDedup', () => ({
  findExistingFileNames,
  fileKey: (name: string, size: number) => `${name}::${size}`,
}));

import { nativeScan } from '@/lib/capacitorScanner';

const MAXYMO_PATH = 'Pictures/maxymo/lyft';

function mockFolderListing(files: { name: string; size: number; mtime: number }[]) {
  readdir.mockImplementation(async ({ path }: { path: string }) => {
    if (path === MAXYMO_PATH) {
      return { files: files.map((f) => ({ ...f, type: 'file' })) };
    }
    return { files: [] };
  });
}

describe('nativeScan prefilter', () => {
  beforeEach(() => {
    readdir.mockReset();
    readFile.mockReset();
    findExistingFileNames.mockReset();
    readFile.mockResolvedValue({ data: 'AAAA' });
    localStorage.clear();
  });

  it('does not read bytes for a file already in the registry', async () => {
    mockFolderListing([
      { name: 'known.jpg', size: 100, mtime: 1 },
      { name: 'new.jpg', size: 200, mtime: 2 },
    ]);
    findExistingFileNames.mockResolvedValue(new Set(['known.jpg::100']));

    const files = await nativeScan('');

    expect(findExistingFileNames).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: 'known.jpg', size: 100 },
        { name: 'new.jpg', size: 200 },
      ]),
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${MAXYMO_PATH}/new.jpg` }),
    );
    expect(files.map((f) => f.name)).toEqual(['new.jpg']);
  });

  it('skipPrefilter (Scan complet) bypasses the registry check entirely', async () => {
    mockFolderListing([{ name: 'known.jpg', size: 100, mtime: 1 }]);

    const files = await nativeScan('', true);

    expect(findExistingFileNames).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(files.map((f) => f.name)).toEqual(['known.jpg']);
  });

  it('skips the registry query entirely when nothing matches the name filter', async () => {
    mockFolderListing([{ name: 'unrelated.jpg', size: 50, mtime: 1 }]);

    const files = await nativeScan('maxymo-only-needle');

    expect(findExistingFileNames).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(files).toEqual([]);
  });
});
