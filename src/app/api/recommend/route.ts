import { analyzePhoto, RecommendationError } from "@/lib/server/gemma";
import { readPhoto } from "@/lib/server/image";
import { resolveCandidates } from "@/lib/server/spotify-search";
import { photoScores, rankCandidates } from "@/lib/mood";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      {
        error: {
          code: "origin",
          message: "Please submit your photo from Vibe Check.",
        },
      },
      { status: 403, headers },
    );
  try {
    const image = await readPhoto(request);
    const analysis = await analyzePhoto(image);
    const resolved = await resolveCandidates(analysis.candidates);
    const candidates = rankCandidates(
      photoScores(analysis.photo_profile),
      analysis.weights,
      resolved,
    );
    const winnerId =
      candidates.find((c) => c.resolution.kind === "verified")?.id ?? null;
    return Response.json(
      { ...analysis, candidates, winnerId, requestId: crypto.randomUUID() },
      { headers },
    );
  } catch (error) {
    if (error instanceof RecommendationError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers },
      );
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Something went wrong. Please try again.",
        },
      },
      { status: 503, headers },
    );
  }
}
