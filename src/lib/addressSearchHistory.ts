export interface SearchHistoryEntry {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  searchedAt: number;
}

const STORAGE_KEY = 'delivroom_search_history';
const MAX_ENTRIES = 5;

function load(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SearchHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: SearchHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota exceeded or private-mode restriction — ignore
  }
}

export function getSearchHistory(): SearchHistoryEntry[] {
  return load();
}

/**
 * Records a selected address, most-recent-first, deduped by id, capped at 5.
 * Returns the updated list so callers can update UI state without a re-read.
 */
export function addToSearchHistory(
  entry: Omit<SearchHistoryEntry, 'searchedAt'>,
): SearchHistoryEntry[] {
  const existing = load().filter((e) => e.id !== entry.id);
  const next = [{ ...entry, searchedAt: Date.now() }, ...existing].slice(
    0,
    MAX_ENTRIES,
  );
  save(next);
  return next;
}

export function removeFromSearchHistory(id: string): SearchHistoryEntry[] {
  const next = load().filter((e) => e.id !== id);
  save(next);
  return next;
}

export function clearSearchHistory(): SearchHistoryEntry[] {
  save([]);
  return [];
}
