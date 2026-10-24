import { z } from "zod";

export const PARAMS = [
  "energy",
  "positivity",
  "tempo",
  "texture",
  "space",
  "nostalgia",
] as const;
export type Param = (typeof PARAMS)[number];
export const PARAM_LABELS: Record<Param, string> = {
  energy: "Energy",
  positivity: "Positivity",
  tempo: "Tempo",
  texture: "Texture",
  space: "Space",
  nostalgia: "Nostalgia",
};
export const PARAM_ENDS: Record<Param, readonly [string, string]> = {
  energy: ["Still", "Intense"],
  positivity: ["Heavy", "Joyful"],
  tempo: ["Slow", "Fast"],
  texture: ["Organic", "Synthetic"],
  space: ["Intimate", "Expansive"],
  nostalgia: ["Modern", "Timeless"],
};
const score = z
  .number()
  .finite()
  .transform((value) => Math.round(Math.min(10, Math.max(0, value))));
export const profileSchema = z.object({
  energy: score,
  positivity: score,
  tempo: score,
  texture: score,
  space: score,
  nostalgia: score,
});
export type Profile = z.infer<typeof profileSchema>;
export type Weights = Record<Param, number>;
export const DEFAULT_WEIGHTS: Weights = {
  energy: 0.25,
  positivity: 0.25,
  tempo: 0.15,
  texture: 0.15,
  space: 0.1,
  nostalgia: 0.1,
};
const rawWeightsSchema = z.object({
  energy: z.number().finite(),
  positivity: z.number().finite(),
  tempo: z.number().finite(),
  texture: z.number().finite(),
  space: z.number().finite(),
  nostalgia: z.number().finite(),
});
export function normalizeWeights(input: unknown): Weights {
  const parsed = rawWeightsSchema.safeParse(input);
  if (!parsed.success) return { ...DEFAULT_WEIGHTS };
  const weights = { ...parsed.data };
  for (const p of PARAMS) weights[p] = Math.max(0.05, weights[p]);
  const scale = Math.max(...PARAMS.map((p) => weights[p]));
  const total = PARAMS.reduce((sum, p) => sum + weights[p] / scale, 0);
  for (const p of PARAMS) weights[p] = weights[p] / scale / total;
  return weights;
}
const text = z.string().trim().min(1).max(600);
const evidenceSchema = z.object({ score, evidence: text });
export const photoProfileSchema = z.object({
  energy: evidenceSchema,
  positivity: evidenceSchema,
  tempo: evidenceSchema,
  texture: evidenceSchema,
  space: evidenceSchema,
  nostalgia: evidenceSchema,
});
export const candidateSchema = z.object({
  title: text,
  artist: text,
  profile: profileSchema,
  fit_note: text,
});
export type Candidate = z.infer<typeof candidateSchema>;
export const analysisSchema = z.object({
  vibe_summary: text,
  photo_profile: photoProfileSchema,
  weights: z.unknown().transform(normalizeWeights),
  weights_reason: text,
  candidates: z
    .array(candidateSchema)
    .length(8)
    .refine(
      (items) =>
        new Set(
          items.map(
            (c) =>
              `${c.title.toLocaleLowerCase()}|${c.artist.toLocaleLowerCase()}`,
          ),
        ).size === 8,
      "Suggest eight distinct songs",
    ),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const albumCoverUrlSchema = z.string().url().pipe(z.string().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "i.scdn.co" &&
    url.port === "" && url.username === "" && url.password === "" &&
    /^\/image\/[A-Za-z0-9]+$/.test(url.pathname) && !url.search && !url.hash;
}, "Expected a Spotify album image"));
export const resolutionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verified"),
    trackId: z.string().regex(/^[A-Za-z0-9]{22}$/),
    uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
    url: z.string().url(),
    title: text,
    artist: text,
    albumCoverUrl: albumCoverUrlSchema.optional(),
  }),
  z.object({ kind: z.literal("unverified"), url: z.string().url() }),
]);
export type Resolution = z.infer<typeof resolutionSchema>;
export const rankedCandidateSchema = candidateSchema.extend({
  id: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
  score: z.number().int().min(0).max(100),
  gaps: profileSchema,
  resolution: resolutionSchema,
});
export type RankedCandidate = z.infer<typeof rankedCandidateSchema>;
export const recommendationSchema = analysisSchema
  .omit({ candidates: true })
  .extend({
    weights: rawWeightsSchema,
    requestId: z.string(),
    candidates: z.array(rankedCandidateSchema).length(8),
    winnerId: z.number().int().nullable(),
  });
export type Recommendation = z.infer<typeof recommendationSchema>;

export function photoScores(photo: Analysis["photo_profile"]): Profile {
  return {
    energy: photo.energy.score,
    positivity: photo.positivity.score,
    tempo: photo.tempo.score,
    texture: photo.texture.score,
    space: photo.space.score,
    nostalgia: photo.nostalgia.score,
  };
}
export function parameterGaps(photo: Profile, song: Profile): Profile {
  return {
    energy: Math.abs(photo.energy - song.energy),
    positivity: Math.abs(photo.positivity - song.positivity),
    tempo: Math.abs(photo.tempo - song.tempo),
    texture: Math.abs(photo.texture - song.texture),
    space: Math.abs(photo.space - song.space),
    nostalgia: Math.abs(photo.nostalgia - song.nostalgia),
  };
}
export function matchScore(
  photo: Profile,
  song: Profile,
  weights: Weights,
): number {
  const distance = PARAMS.reduce(
    (sum, p) => sum + weights[p] * Math.abs(photo[p] - song[p]),
    0,
  );
  return Math.round(100 * (1 - distance / 10));
}
export function rankCandidates(
  photo: Profile,
  weights: Weights,
  candidates: (Candidate & { resolution: Resolution })[],
): RankedCandidate[] {
  return candidates
    .map((candidate, id) => ({
      ...candidate,
      id,
      rank: 0,
      score: matchScore(photo, candidate.profile, weights),
      gaps: parameterGaps(photo, candidate.profile),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.resolution.kind === "verified") -
          Number(a.resolution.kind === "verified") ||
        Math.max(...PARAMS.map((p) => a.gaps[p])) -
          Math.max(...PARAMS.map((p) => b.gaps[p])) ||
        a.id - b.id,
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
