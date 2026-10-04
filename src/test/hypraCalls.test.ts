import { loadHypraCalls, recordHypraCall } from '@/lib/hypraCalls';
import { beforeEach, describe, expect, it } from 'vitest';

describe('hypraCalls', () => {
  beforeEach(() => localStorage.clear());

  it('ajoute un appel avec taximeterFare null et le relit', () => {
    recordHypraCall({ pickupKm: 4.2, mode: 'large' });
    const calls = loadHypraCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ pickupKm: 4.2, mode: 'large', taximeterFare: null });
  });

  it('borne l\'historique à 500 entrées (garde les plus récentes)', () => {
    for (let i = 0; i < 502; i++) recordHypraCall({ pickupKm: i, mode: 'strict' });
    const calls = loadHypraCalls();
    expect(calls).toHaveLength(500);
    expect(calls[0]!.pickupKm).toBe(2);
  });

  it('retourne [] sur un JSON corrompu', () => {
    localStorage.setItem('delivroom-hypra-calls', '{oops');
    expect(loadHypraCalls()).toEqual([]);
  });
});
