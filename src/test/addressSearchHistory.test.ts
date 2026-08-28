import {
  addToSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeFromSearchHistory,
} from '@/lib/addressSearchHistory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('addressSearchHistory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('adds entries most-recent-first', () => {
    addToSearchHistory({ id: 'a', name: 'Adresse A', latitude: 45.5, longitude: -73.6 });
    addToSearchHistory({ id: 'b', name: 'Adresse B', latitude: 45.6, longitude: -73.5 });

    expect(getSearchHistory().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('dedupes by id, moving the re-searched entry back to the front', () => {
    addToSearchHistory({ id: 'a', name: 'Adresse A', latitude: 45.5, longitude: -73.6 });
    addToSearchHistory({ id: 'b', name: 'Adresse B', latitude: 45.6, longitude: -73.5 });
    addToSearchHistory({ id: 'a', name: 'Adresse A', latitude: 45.5, longitude: -73.6 });

    expect(getSearchHistory().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('caps at 5 entries, dropping the oldest', () => {
    for (let i = 0; i < 7; i++) {
      addToSearchHistory({ id: `z${i}`, name: `Zone ${i}`, latitude: 45.5, longitude: -73.6 });
    }
    const history = getSearchHistory();
    expect(history).toHaveLength(5);
    expect(history.map((e) => e.id)).toEqual(['z6', 'z5', 'z4', 'z3', 'z2']);
  });

  it('removes a single entry by id', () => {
    addToSearchHistory({ id: 'a', name: 'Adresse A', latitude: 45.5, longitude: -73.6 });
    addToSearchHistory({ id: 'b', name: 'Adresse B', latitude: 45.6, longitude: -73.5 });

    removeFromSearchHistory('a');

    expect(getSearchHistory().map((e) => e.id)).toEqual(['b']);
  });

  it('clears the whole history', () => {
    addToSearchHistory({ id: 'a', name: 'Adresse A', latitude: 45.5, longitude: -73.6 });
    clearSearchHistory();
    expect(getSearchHistory()).toEqual([]);
  });
});
