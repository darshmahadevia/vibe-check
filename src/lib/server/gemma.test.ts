import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentParameters, GoogleGenAIOptions } from "@google/genai";
vi.mock("server-only", () => ({}));
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models;

    constructor(options: GoogleGenAIOptions) {
      this.models = {
        async generateContent(params: GenerateContentParameters) {
          const signal = params.config?.abortSignal;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let onAbort = () => {};
          const deadline = new Promise<never>((_, reject) => {
            onAbort = () => reject(new DOMException("Aborted", "AbortError"));
            if (signal?.aborted) onAbort();
            else signal?.addEventListener("abort", onAbort, { once: true });
            if (options.httpOptions?.timeout) {
              timer = setTimeout(
                () => reject({ status: 504 }),
                options.httpOptions.timeout,
              );
            }
          });
          try {
            return await Promise.race([generateContent(params), deadline]);
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
          }
        },
      };
    }
  },
}));
import { analyzePhoto, parseAnalysis } from "./gemma";
import { DEFAULT_WEIGHTS, PARAMS } from "../mood";
export const validAnalysis = () => ({
  vibe_summary: "A quiet evening.",
  photo_profile: Object.fromEntries(
    PARAMS.map((p) => [
      p,
      { score: 3, evidence: "Soft evening light on an empty street" },
    ]),
  ),
  weights: DEFAULT_WEIGHTS,
  weights_reason: "Stillness matters most.",
  candidates: Array.from({ length: 8 }, (_, i) => ({
    title: `Song ${i}`,
    artist: "Artist",
    profile: Object.fromEntries(PARAMS.map((p) => [p, 3])),
    fit_note: "A calm arrangement.",
  })),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});
afterEach(() => vi.restoreAllMocks());
describe("Gemma boundary", () => {
  describe("generation deadline", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      // Node's native AbortSignal.timeout does not use Vitest's fake clock.
      vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), milliseconds);
        return controller.signal;
      });
    });
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("allows a valid generation that takes sixty seconds", async () => {
      generateContent.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () => resolve({ text: JSON.stringify(validAnalysis()) }),
              60_000,
            );
          }),
      );
      const result = analyzePhoto(new Uint8Array([1])).then(
        (analysis) => ({ analysis }),
        (error: unknown) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await result).toEqual({ analysis: validAnalysis() });
      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it("limits generation and its invalid-output retry to one hundred seconds total", async () => {
      generateContent
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ text: "bad json" }), 60_000);
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve({ text: JSON.stringify(validAnalysis()) }),
                60_000,
              );
            }),
        );
      const analysis = analyzePhoto(new Uint8Array([1]));
      const settled = vi.fn();
      void analysis.then(settled, settled);
      await vi.advanceTimersByTimeAsync(99_999);
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledTimes(1);
      await expect(analysis).rejects.toMatchObject({
        code: "model_unavailable",
        status: 503,
      });
    });
  });
  it("parses fenced JSON and defaults invalid weights", () => {
    const data = validAnalysis();
    expect(
      parseAnalysis(
        "```json\n" + JSON.stringify({ ...data, weights: null }) + "\n```",
      ).weights,
    ).toEqual(DEFAULT_WEIGHTS);
  });
  it("uses one call with inline JPEG and all eight songs", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify(validAnalysis()),
    });
    expect(
      (await analyzePhoto(new Uint8Array([1, 2]))).candidates,
    ).toHaveLength(8);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(
      generateContent.mock.calls[0][0].contents[0].parts[0].inlineData.mimeType,
    ).toBe("image/jpeg");
  });
  it("retries unusable output once", async () => {
    generateContent
      .mockResolvedValueOnce({ text: "bad json" })
      .mockResolvedValueOnce({ text: JSON.stringify(validAnalysis()) });
    await analyzePhoto(new Uint8Array([1]));
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("stops after two invalid outputs", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({
      code: "invalid_output",
      status: 502,
    });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("does not retry quota errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValue({ status: 429 });
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({
      code: "quota",
      status: 429,
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("records the provider status without logging private error content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValue(
      Object.assign(new Error("private credentials and photo data"), {
        status: 403,
      }),
    );
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({
      code: "model_unavailable",
      status: 503,
    });
    expect(log).toHaveBeenCalledExactlyOnceWith("Gemma request failed", {
      providerStatus: 403,
      failure: "request",
      elapsedMs: expect.any(Number),
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("identifies aborted requests without exposing the error message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValue(
      new DOMException("private request details", "AbortError"),
    );
    await expect(analyzePhoto(new Uint8Array([1]))).rejects.toMatchObject({
      code: "model_unavailable",
    });
    expect(log).toHaveBeenCalledExactlyOnceWith("Gemma request failed", {
      providerStatus: null,
      failure: "aborted",
      elapsedMs: expect.any(Number),
    });
  });
  it("rejects duplicates and missing profile fields", () => {
    const data = validAnalysis();
    expect(() =>
      parseAnalysis(
        JSON.stringify({
          ...data,
          candidates: Array(8).fill(data.candidates[0]),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseAnalysis(JSON.stringify({ ...data, photo_profile: {} })),
    ).toThrow();
  });
});
