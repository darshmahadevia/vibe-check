import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/gemma", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/gemma")>("@/lib/server/gemma");
  return { ...actual, analyzePhoto: vi.fn() };
});
vi.mock("@/lib/server/spotify-search", () => ({ resolveCandidates: vi.fn() }));
import { POST } from "./route";
import { analyzePhoto, RecommendationError } from "@/lib/server/gemma";
import { resolveCandidates } from "@/lib/server/spotify-search";
import { analysisSchema, DEFAULT_WEIGHTS, PARAMS } from "@/lib/mood";
const analysis = analysisSchema.parse({
  vibe_summary: "Quiet street", photo_profile: Object.fromEntries(PARAMS.map(p => [p, { score: 3, evidence: "Empty street" }])), weights: DEFAULT_WEIGHTS, weights_reason: "A still scene",
  candidates: Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: "Artist", fit_note: "Calm", profile: Object.fromEntries(PARAMS.map(p => [p, i === 0 ? 3 : 4])) })),
});
async function request() {
  const form = new FormData();
  form.set("photo", new Blob([Uint8Array.from(await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).jpeg().toBuffer())], { type: "image/jpeg" }), "photo.jpg");
  return new Request("https://vibe.test/api/recommend", { method: "POST", body: form, headers: { origin: "https://vibe.test" } });
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(analyzePhoto).mockResolvedValue(analysis); });
it("keeps eight candidates and chooses the highest verified song", async () => {
  vi.mocked(resolveCandidates).mockResolvedValue(analysis.candidates.map((candidate, i) => ({ ...candidate, resolution: i === 1 ? { kind: "verified", trackId: "1234567890123456789012", uri: "spotify:track:1234567890123456789012", url: "https://open.spotify.com/track/1234567890123456789012", title: candidate.title, artist: candidate.artist } : { kind: "unverified", url: "https://open.spotify.com/search/test" } })));
  const response = await POST(await request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body.candidates).toHaveLength(8);
  expect(body.candidates[0].score).toBe(100);
  expect(body.winnerId).toBe(1);
});
it("returns no queue winner when every search fails", async () => {
  vi.mocked(resolveCandidates).mockResolvedValue(analysis.candidates.map(candidate => ({ ...candidate, resolution: { kind: "unverified", url: "https://open.spotify.com/search/test" } })));
  expect((await (await POST(await request())).json()).winnerId).toBeNull();
});
it("returns the quota error without exposing upstream details", async () => {
  vi.mocked(analyzePhoto).mockRejectedValue(new RecommendationError("quota", "Too many requests right now. Wait a minute and try again.", 429));
  expect((await POST(await request())).status).toBe(429);
  expect(resolveCandidates).not.toHaveBeenCalled();
});
it("rejects cross-origin requests before processing", async () => {
  const response = await POST(new Request("https://vibe.test/api/recommend", { method: "POST", headers: { origin: "https://other.test" } }));
  expect(response.status).toBe(403);
  expect(analyzePhoto).not.toHaveBeenCalled();
});
