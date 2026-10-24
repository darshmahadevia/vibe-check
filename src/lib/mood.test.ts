import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, matchScore, normalizeWeights, parameterGaps, profileSchema, rankCandidates, type Profile, type Resolution } from "./mood";
const low: Profile = { energy: 0, positivity: 0, tempo: 0, texture: 0, space: 0, nostalgia: 0 };
const high: Profile = { energy: 10, positivity: 10, tempo: 10, texture: 10, space: 10, nostalgia: 10 };
const unverified: Resolution = { kind: "unverified", url: "https://open.spotify.com/search/test" };
const verified: Resolution = { kind: "verified", trackId: "1234567890123456789012", uri: "spotify:track:1234567890123456789012", url: "https://open.spotify.com/track/1234567890123456789012", title: "Test", artist: "Artist" };
const candidate = (profile: Profile, resolution: Resolution = unverified) => ({ title: "Test", artist: "Artist", profile, fit_note: "Fits", resolution });
describe("transparent mood ranking", () => {
  it("scores perfect and opposite matches", () => {
    expect(matchScore(low, low, DEFAULT_WEIGHTS)).toBe(100);
    expect(matchScore(low, high, DEFAULT_WEIGHTS)).toBe(0);
  });
  it("uses a hand-calculated weighted distance", () => {
    expect(matchScore(low, { ...low, energy: 4, positivity: 2 }, DEFAULT_WEIGHTS)).toBe(85);
  });
  it("clamps and rounds scores", () => {
    expect(profileSchema.parse({ ...low, energy: -3, positivity: 20, tempo: 3.6 })).toEqual({ ...low, energy: 0, positivity: 10, tempo: 4 });
  });
  it("normalizes weights after a .05 floor", () => {
    const weights = normalizeWeights({ energy: -1, positivity: 0, tempo: 1, texture: 2, space: 3, nostalgia: 4 });
    expect(Object.values(weights).reduce((a, b) => a + b)).toBeCloseTo(1);
    expect(weights.energy).toBeCloseTo(.05 / 10.1);
  });
  it.each([undefined, null, {}, { ...DEFAULT_WEIGHTS, energy: "bad" }, { ...DEFAULT_WEIGHTS, energy: Infinity }])("uses defaults for invalid weights %j", value => {
    expect(normalizeWeights(value)).toEqual(DEFAULT_WEIGHTS);
  });
  it("handles very large finite weights without overflow", () => {
    expect(normalizeWeights({ energy: 1e308, positivity: 1e308, tempo: 1e308, texture: 1e308, space: 1e308, nostalgia: 1e308 }).energy).toBeCloseTo(1 / 6);
  });
  it("returns every parameter gap", () => {
    expect(parameterGaps(low, high)).toEqual(high);
  });
  it("uses verification to break rounded-score ties", () => {
    const weights = normalizeWeights({ energy: .05, positivity: 1, tempo: 1, texture: 1, space: 1, nostalgia: 1 });
    const ranked = rankCandidates(low, weights, [candidate(low), candidate({ ...low, energy: 1 }, verified)]);
    expect(ranked[0].resolution.kind).toBe("verified");
  });
  it("breaks score ties by the smallest worst gap, then preserves input order", () => {
    const weights = normalizeWeights({ energy: 1, positivity: 1, tempo: 1, texture: 1, space: 1, nostalgia: 1 });
    const ranked = rankCandidates(low, weights, [candidate({ ...low, energy: 6 }), candidate({ ...low, energy: 3, positivity: 3 }), candidate({ ...low, energy: 3, positivity: 3 })]);
    expect(ranked.map(c => c.id)).toEqual([1, 2, 0]);
    expect(ranked.map(c => c.rank)).toEqual([1, 2, 3]);
  });
});
