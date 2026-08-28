import { geocodeSuggestions } from "@/lib/geocoding";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CENTRE_BELL_FEATURE = {
  id: "poi.centre-bell",
  center: [-73.5693, 45.4961] as [number, number],
  place_name:
    "Centre Bell, 1909 Avenue des Canadiens-de-Montréal, Montréal, Québec, Canada",
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function calledUrl(): string {
  return vi.mocked(fetch).mock.calls[0][0] as string;
}

describe("geocodeSuggestions", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends the full query intact (no word truncation) and returns Centre Bell for "centre bell montréal"', async () => {
    mockFetchOnce({ features: [CENTRE_BELL_FEATURE] });

    const results = await geocodeSuggestions("centre bell montréal");

    // Entire phrase URL-encoded in the request — not just the last word
    expect(calledUrl()).toContain("centre%20bell%20montr%C3%A9al.json");

    expect(results[0].name).toContain("Centre Bell");
    expect(results[0].name).toContain("1909 Avenue des Canadiens-de-Montréal");
    expect(results[0].latitude).toBeCloseTo(45.4961);
    expect(results[0].longitude).toBeCloseTo(-73.5693);
  });

  it("requests POI + address + neighborhood + locality types with autocomplete", async () => {
    mockFetchOnce({ features: [] });

    await geocodeSuggestions("centre bell");

    const url = calledUrl();
    expect(url).toContain("types=poi,address,neighborhood,locality");
    expect(url).toContain("autocomplete=true");
    expect(url).toContain("country=CA");
    expect(url).toContain("bbox=");
  });

  it("uses the driver GPS position as proximity bias when provided", async () => {
    mockFetchOnce({ features: [] });

    await geocodeSuggestions("place bell", {
      proximity: { latitude: 45.5601, longitude: -73.7215 }, // Laval
    });

    expect(calledUrl()).toContain("proximity=-73.7215,45.5601");
  });

  it("falls back to downtown Montréal proximity without a GPS fix", async () => {
    mockFetchOnce({ features: [] });

    await geocodeSuggestions("centre bell");

    expect(calledUrl()).toContain("proximity=-73.5673,45.5017");
  });

  it("returns [] on empty query, missing token, or HTTP error", async () => {
    mockFetchOnce({ features: [CENTRE_BELL_FEATURE] });
    expect(await geocodeSuggestions("   ")).toEqual([]);

    vi.stubEnv("VITE_MAPBOX_TOKEN", "");
    expect(await geocodeSuggestions("centre bell")).toEqual([]);
    vi.stubEnv("VITE_MAPBOX_TOKEN", "test-token");

    mockFetchOnce({}, false, 500);
    expect(await geocodeSuggestions("centre bell")).toEqual([]);
  });
});
