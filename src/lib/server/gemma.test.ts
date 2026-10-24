import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; } }));
import { analyzePhoto, parseAnalysis } from "./gemma";
import { DEFAULT_WEIGHTS, PARAMS } from "../mood";
export const validAnalysis = () => ({
  vibe_summary: "A quiet evening.",
  photo_profile: Object.fromEntries(PARAMS.map(p => [p, { score: 3, evidence: "Soft evening light on an empty street" }])),
  weights: DEFAULT_WEIGHTS, weights_reason: "Stillness matters most.",
  candidates: Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: "Artist", profile: Object.fromEntries(PARAMS.map(p => [p, 3])), fit_note: "A calm arrangement." })),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("GEMINI_API_KEY", "test-key"); });
describe("Gemma boundary", () => {
  it("parses fenced JSON and defaults invalid weights", () => {
    const data = validAnalysis();
    expect(parseAnalysis('```json\n' + JSON.stringify({ ...data, weights: null }) + '\n```').weights).toEqual(DEFAULT_WEIGHTS);
  });
  it("uses one call with inline JPEG and all eight songs", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify(validAnalysis()) });
    expect((await analyzePhoto(new Uint8Array([1, 2]))).candidates).toHaveLength(8);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].inlineData.mimeType).toBe("image/jpeg");
  });
  it("retries unusable output once", async () => {
    generateContent.mockResolvedValueOnce({ text: "bad json" }).mockResolvedValueOnce({ text: JSON.stringify(validAnalysis()) });
    await analyzePhoto(new Uint8Array([1]));
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("stops after two invalid outputs", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({ code: "invalid_output", status: 502 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("does not retry quota errors", async () => {
    generateContent.mockRejectedValue({ status: 429 });
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({ code: "quota", status: 429 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicates and missing profile fields", () => {
    const data = validAnalysis();
    expect(() => parseAnalysis(JSON.stringify({ ...data, candidates: Array(8).fill(data.candidates[0]) }))).toThrow();
    expect(() => parseAnalysis(JSON.stringify({ ...data, photo_profile: {} }))).toThrow();
  });
});
