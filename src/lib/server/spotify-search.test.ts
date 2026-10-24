import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "../mood";

vi.mock("server-only", () => ({}));

const trackId = "0123456789ABCDEFGHIJKL";
const candidates: Candidate[] = Array.from({ length: 8 }, (_, index) => ({
  title: `Song ${index}`,
  artist: "Artist",
  profile: {
    energy: 3,
    positivity: 4,
    tempo: 5,
    texture: 6,
    space: 7,
    nostalgia: 8,
  },
  fit_note: "A calm arrangement.",
}));
const tokenResponse = () =>
  Response.json({
    access_token: "test-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
const trackResponse = (title: string, artist = "Artist") =>
  Response.json({
    tracks: {
      items: [{ id: trackId, name: title, artists: [{ name: artist }] }],
    },
  });
const fetchMock = vi.fn<typeof fetch>();

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input.toString());
}

function matchingResponse(input: Parameters<typeof fetch>[0]): Response {
  const url = requestUrl(input);
  if (url.pathname === "/api/token") return tokenResponse();
  const title =
    url.searchParams.get("q")?.match(/^track:"(.*?)" artist:/)?.[1] ?? "";
  return trackResponse(title);
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SPOTIFY_CLIENT_ID", "client-id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "client-secret");
  fetchMock.mockImplementation(async (input) => matchingResponse(input));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Spotify search boundary", () => {
  it("starts all eight limit-one searches before any completes and preserves input order", async () => {
    const releases: (() => void)[] = [];
    fetchMock.mockImplementation(async (input) => {
      if (requestUrl(input).pathname === "/api/token") return tokenResponse();
      return new Promise<Response>((resolve) =>
        releases.push(() => resolve(matchingResponse(input))),
      );
    });
    const { resolveCandidates } = await import("./spotify-search");
    const result = resolveCandidates(candidates);
    await vi.waitFor(() => expect(releases).toHaveLength(8));
    for (const release of releases.reverse()) release();
    expect(await result).toEqual(
      candidates.map((candidate) => ({
        ...candidate,
        resolution: {
          kind: "verified",
          trackId,
          uri: `spotify:track:${trackId}`,
          url: `https://open.spotify.com/track/${trackId}`,
          title: candidate.title,
          artist: candidate.artist,
        },
      })),
    );
    expect(fetchMock).toHaveBeenCalledTimes(9);
    for (const [input, options] of fetchMock.mock.calls) {
      const url = requestUrl(input);
      expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (url.pathname === "/api/token") {
        expect(url.origin).toBe("https://accounts.spotify.com");
        expect(options).toMatchObject({
          method: "POST",
          body: "grant_type=client_credentials",
          headers: {
            Authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
          },
        });
      } else {
        expect(url.origin).toBe("https://api.spotify.com");
        expect(url.pathname).toBe("/v1/search");
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          type: "track",
          limit: "1",
          market: "US",
        });
        expect(url.searchParams.get("q")).toMatch(
          /^track:"Song [0-7]" artist:"Artist"$/,
        );
        expect(options?.headers).toEqual({
          Authorization: "Bearer test-token",
        });
      }
    }
  });

  it("shares a pending token between concurrent batches, caches it, and refreshes at expiry", async () => {
    vi.useFakeTimers();
    let releaseToken: (response: Response) => void = () => {
      throw new Error("Token not requested");
    };
    fetchMock.mockImplementation(async (input) => {
      if (requestUrl(input).pathname === "/api/token") {
        return new Promise<Response>((resolve) => {
          releaseToken = resolve;
        });
      }
      return matchingResponse(input);
    });
    const { resolveCandidates } = await import("./spotify-search");
    const first = resolveCandidates(candidates);
    const second = resolveCandidates(candidates);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseToken(tokenResponse());
    await Promise.all([first, second]);
    fetchMock.mockImplementation(async (input) => matchingResponse(input));
    await vi.advanceTimersByTimeAsync(3_599_999);
    await resolveCandidates(candidates);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => requestUrl(input).pathname === "/api/token",
      ),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveCandidates(candidates);
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => requestUrl(input).pathname === "/api/token",
      ),
    ).toHaveLength(2);
  });

  it.each([
    "malformed",
    "403",
    "429",
    "empty",
    "title mismatch",
    "artist mismatch",
    "invalid id",
    "network",
    "invalid JSON",
  ])(
    "falls back per item for %s without retrying or losing other results",
    async (failure) => {
      fetchMock.mockImplementation(async (input) => {
        const url = requestUrl(input);
        if (url.pathname === "/api/token") return tokenResponse();
        if (!url.searchParams.get("q")?.includes('track:"Song 0"'))
          return matchingResponse(input);
        if (failure === "403" || failure === "429")
          return new Response(null, { status: Number(failure) });
        if (failure === "empty")
          return Response.json({ tracks: { items: [] } });
        if (failure === "title mismatch")
          return trackResponse("Different song");
        if (failure === "artist mismatch")
          return trackResponse("Song 0", "Someone else");
        if (failure === "invalid id")
          return Response.json({
            tracks: {
              items: [
                { id: "bad", name: "Song 0", artists: [{ name: "Artist" }] },
              ],
            },
          });
        if (failure === "network") throw new TypeError("Network failed");
        if (failure === "invalid JSON") return new Response("{");
        return Response.json({ tracks: {} });
      });
      const { resolveCandidates } = await import("./spotify-search");
      const result = await resolveCandidates(candidates);
      expect(result[0].resolution).toEqual({
        kind: "unverified",
        url: "https://open.spotify.com/search/Song%200%20Artist",
      });
      expect(
        result
          .slice(1)
          .every((candidate) => candidate.resolution.kind === "verified"),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(9);
    },
  );

  it.each(["missing configuration", "403", "429", "malformed", "network"])(
    "falls back for every candidate on token %s",
    async (failure) => {
      if (failure === "missing configuration")
        vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
      fetchMock.mockImplementation(async () => {
        if (failure === "network") throw new TypeError("Network failed");
        if (failure === "403" || failure === "429")
          return new Response(null, { status: Number(failure) });
        return Response.json({ access_token: "invalid" });
      });
      const { resolveCandidates } = await import("./spotify-search");
      const result = await resolveCandidates(candidates);
      expect(
        result.every((candidate) => candidate.resolution.kind === "unverified"),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(
        failure === "missing configuration" ? 0 : 1,
      );
      fetchMock.mockImplementation(async (input) => matchingResponse(input));
      if (failure === "missing configuration")
        vi.stubEnv("SPOTIFY_CLIENT_SECRET", "client-secret");
      expect(
        (await resolveCandidates(candidates)).every(
          (candidate) => candidate.resolution.kind === "verified",
        ),
      ).toBe(true);
    },
  );

  it("normalizes titles and matches any returned artist while keeping Spotify metadata", async () => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).pathname === "/api/token"
        ? tokenResponse()
        : Response.json({
            tracks: {
              items: [
                {
                  id: trackId,
                  name: "  SONG 0!  ",
                  artists: [{ name: "Collaborator" }, { name: "ARTIST" }],
                  uri: "spotify:track:untrusted",
                  external_urls: { spotify: "https://untrusted.example" },
                },
              ],
            },
          }),
    );
    const { resolveCandidates } = await import("./spotify-search");
    const result = await resolveCandidates(candidates);
    expect(result[0].resolution).toEqual({
      kind: "verified",
      trackId,
      uri: `spotify:track:${trackId}`,
      url: `https://open.spotify.com/track/${trackId}`,
      title: "SONG 0!",
      artist: "Collaborator, ARTIST",
    });
  });

  it.each([
    ["https://i.scdn.co/image/ab67616d0000b2730123456789abcdef", true],
    ["https://i.scdn.co.evil.example/image/abc", false],
    ["http://i.scdn.co/image/abc", false],
    ["https://user@i.scdn.co/image/abc", false],
    ["https://i.scdn.co/image/abc?redirect=evil", false],
    ["javascript:alert(1)", false],
    ["not-a-url", false],
    ["", false],
    [null, false],
  ])("accepts only Spotify album images from the search boundary (%s)", async (url, accepted) => {
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).pathname === "/api/token" ? tokenResponse() : Response.json({
        tracks: { items: [{ id: trackId, name: "Song 0", artists: [{ name: "Artist" }],
          album: { images: [{ url }] },
        }] },
      }));
    const { resolveCandidates } = await import("./spotify-search");
    const [candidate] = await resolveCandidates([candidates[0]]);
    expect(candidate.resolution.kind).toBe("verified");
    if (candidate.resolution.kind === "verified") {
      expect(candidate.resolution.albumCoverUrl).toBe(accepted ? url : undefined);
    }
  });

  it("escapes quoted filters and encodes the fallback search path", async () => {
    const candidate = {
      ...candidates[0],
      title: 'A "quote" \\ OR artist:other',
      artist: 'Artist / ?#&"',
    };
    fetchMock.mockImplementation(async (input) =>
      requestUrl(input).pathname === "/api/token"
        ? tokenResponse()
        : Response.json({ tracks: { items: [] } }),
    );
    const { resolveCandidates } = await import("./spotify-search");
    const result = await resolveCandidates([candidate]);
    expect(requestUrl(fetchMock.mock.calls[1][0]).searchParams.get("q")).toBe(
      'track:"A \\"quote\\" \\\\ OR artist:other" artist:"Artist / ?#&\\""',
    );
    expect(result[0].resolution).toEqual({
      kind: "unverified",
      url: `https://open.spotify.com/search/${encodeURIComponent(`${candidate.title} ${candidate.artist}`)}`,
    });
  });

  it.each(["token", "search"])(
    "aborts a stalled %s after at most eight seconds",
    async (stalled) => {
      fetchMock.mockImplementation(async (input, options) => {
        if (requestUrl(input).pathname === "/api/token" && stalled === "search")
          return tokenResponse();
        return new Promise<Response>((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      });
      const { resolveCandidates } = await import("./spotify-search");
      const result = resolveCandidates(candidates);
      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledTimes(stalled === "search" ? 9 : 1),
      );
      expect(
        (await result).every(
          (candidate) => candidate.resolution.kind === "unverified",
        ),
      ).toBe(true);
    },
    10_000,
  );
});
