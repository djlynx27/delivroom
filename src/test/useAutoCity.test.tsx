import { nearestCityId, useAutoCity } from '@/hooks/useAutoCity';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('nearestCityId', () => {
  it('returns the closest supported city centroid', () => {
    expect(nearestCityId(45.508, -73.587)).toBe('mtl');
    expect(nearestCityId(45.608, -73.747)).toBe('lvl');
    expect(nearestCityId(45.531, -73.518)).toBe('lng');
  });

  it('keeps Saint-Leonard attached to Montreal instead of Longueuil', () => {
    expect(nearestCityId(45.5876, -73.595)).toBe('mtl');
  });
});

describe('useAutoCity', () => {
  it('auto-selects the detected city when it differs from the current city', () => {
    const setCityId = vi.fn();

    renderHook(() => useAutoCity('mtl', setCityId, 45.608, -73.747));

    expect(setCityId).toHaveBeenCalledWith('lvl');
  });

  it('does not repeatedly overwrite the same detected city', () => {
    const setCityId = vi.fn();
    const { rerender } = renderHook(
      ({ currentCityId, lat, lng }) =>
        useAutoCity(currentCityId, setCityId, lat, lng),
      {
        initialProps: {
          currentCityId: 'mtl',
          lat: 45.608,
          lng: -73.747,
        },
      }
    );

    expect(setCityId).toHaveBeenCalledTimes(1);
    expect(setCityId).toHaveBeenLastCalledWith('lvl');

    rerender({
      currentCityId: 'mtl',
      lat: 45.6075,
      lng: -73.7465,
    });

    expect(setCityId).toHaveBeenCalledTimes(1);
  });

  it('updates again when GPS later resolves to a different supported city', () => {
    const setCityId = vi.fn();
    const { rerender } = renderHook(
      ({ currentCityId, lat, lng }) =>
        useAutoCity(currentCityId, setCityId, lat, lng),
      {
        initialProps: {
          currentCityId: 'mtl',
          lat: 45.608,
          lng: -73.747,
        },
      }
    );

    expect(setCityId).toHaveBeenCalledTimes(1);
    expect(setCityId).toHaveBeenLastCalledWith('lvl');

    rerender({
      currentCityId: 'lvl',
      lat: 45.531,
      lng: -73.518,
    });

    expect(setCityId).toHaveBeenCalledTimes(2);
    expect(setCityId).toHaveBeenLastCalledWith('lng');
  });

  it('does nothing until coordinates are available', () => {
    const setCityId = vi.fn();

    const { rerender } = renderHook(
      ({ currentCityId, lat, lng }) =>
        useAutoCity(currentCityId, setCityId, lat, lng),
      {
        initialProps: {
          currentCityId: 'mtl',
          lat: null as number | null,
          lng: null as number | null,
        },
      }
    );

    expect(setCityId).not.toHaveBeenCalled();

    rerender({
      currentCityId: 'mtl',
      lat: 45.608,
      lng: -73.747,
    });

    expect(setCityId).toHaveBeenCalledTimes(1);
    expect(setCityId).toHaveBeenLastCalledWith('lvl');
  });

  it('preserves a manual override while GPS still resolves to the same city', () => {
    const setCityId = vi.fn();
    const { rerender } = renderHook(
      ({ currentCityId, lat, lng }) =>
        useAutoCity(currentCityId, setCityId, lat, lng),
      {
        initialProps: {
          currentCityId: 'mtl',
          lat: 45.508,
          lng: -73.587,
        },
      }
    );

    expect(setCityId).not.toHaveBeenCalled();

    rerender({
      currentCityId: 'lvl',
      lat: 45.508,
      lng: -73.587,
    });

    expect(setCityId).not.toHaveBeenCalled();
  });

  it('waits for confirmation before switching on an ambiguous border case', () => {
    const setCityId = vi.fn();
    const { rerender } = renderHook(
      ({ currentCityId, lat, lng }) =>
        useAutoCity(currentCityId, setCityId, lat, lng),
      {
        initialProps: {
          currentCityId: 'mtl',
          lat: 45.543,
          lng: -73.546,
        },
      }
    );

    expect(setCityId).not.toHaveBeenCalled();

    rerender({
      currentCityId: 'mtl',
      lat: 45.5432,
      lng: -73.5458,
    });

    expect(setCityId).toHaveBeenCalledTimes(1);
  });
});
