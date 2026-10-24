import "server-only";
import { z } from "zod";
import { resolutionSchema, type Candidate, type Resolution } from "../mood";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86_400),
});
const searchSchema = z.object({
  tracks: z.object({
    items: z
      .array(
        z.object({
          id: z.string().regex(/^[A-Za-z0-9]{22}$/),
          name: z.string().trim().min(1).max(600),
          artists: z
            .array(z.object({ name: z.string().trim().min(1).max(600) }))
            .min(1),
        }),
      )
      .max(1),
  }),
});

let cachedToken: { value: string; expiresAt: number } | undefined;
let pendingToken: Promise<string> | undefined;

async function requestToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim())
    throw new Error("Spotify is not configured");
  const startedAt = Date.now();
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Spotify token failed");
  const token = tokenSchema.parse(await response.json());
  cachedToken = {
    value: token.access_token,
    expiresAt: startedAt + token.expires_in * 1_000,
  };
  return token.access_token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt)
    return cachedToken.value;
  if (pendingToken) return pendingToken;
  pendingToken = requestToken();
  try {
    return await pendingToken;
  } finally {
    pendingToken = undefined;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function quoteFilter(value: string): string {
  return `"${value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\\"]/g, "\\$&")}"`;
}

async function search(candidate: Candidate): Promise<Resolution> {
  const token = await getToken();
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set(
    "q",
    `track:${quoteFilter(candidate.title)} artist:${quoteFilter(candidate.artist)}`,
  );
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");
  url.searchParams.set("market", "US");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Spotify search failed");
  const track = searchSchema.parse(await response.json()).tracks.items[0];
  if (
    !track ||
    !normalize(candidate.title) ||
    !normalize(candidate.artist) ||
    normalize(track.name) !== normalize(candidate.title) ||
    !track.artists.some(
      (artist) => normalize(artist.name) === normalize(candidate.artist),
    )
  ) {
    throw new Error("Spotify track does not match");
  }
  return resolutionSchema.parse({
    kind: "verified",
    trackId: track.id,
    uri: `spotify:track:${track.id}`,
    url: `https://open.spotify.com/track/${track.id}`,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(", "),
  });
}

export async function resolveCandidates(
  candidates: Candidate[],
): Promise<(Candidate & { resolution: Resolution })[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        return { ...candidate, resolution: await search(candidate) };
      } catch {
        return {
          ...candidate,
          resolution: {
            kind: "unverified" as const,
            url: `https://open.spotify.com/search/${encodeURIComponent(`${candidate.title} ${candidate.artist}`)}`,
          },
        };
      }
    }),
  );
}
