import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToQueue,
  connectSpotify,
  disconnectSpotify,
  isSpotifyConnected,
} from "./spotify";
import SpotifyCallbackPage from "@/app/spotify/callback/page";

const hooks = vi.hoisted(() => {
  const effects: Array<() => void> = [];
  return { effects, status: { textContent: "" } };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void) => hooks.effects.push(effect),
  useRef: (initial: unknown) => ({
    current: initial === null ? hooks.status : initial,
  }),
}));

const origin = "http://127.0.0.1:3000";
const uri = "spotify:track:0123456789ABCDEFGHIJKL";
type IncomingMessage = { origin: string; source: unknown; data: unknown };
let listeners: Set<(event: IncomingMessage) => void>;
let popup: {
  closed: boolean;
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let browser: ReturnType<typeof makeBrowser>;

function makeBrowser() {
  return {
    location: { origin, pathname: "/spotify/callback", search: "" },
    history: { state: null, replaceState: vi.fn() },
    opener: { postMessage: vi.fn() },
    open: vi.fn(() => popup),
    addEventListener: (
      type: string,
      listener: (event: IncomingMessage) => void,
    ) => {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener: (
      type: string,
      listener: (event: IncomingMessage) => void,
    ) => {
      if (type === "message") listeners.delete(listener);
    },
  };
}

function send(data: unknown, messageOrigin = origin, source: unknown = popup) {
  for (const listener of listeners)
    listener({ origin: messageOrigin, source, data });
}

function callback() {
  return {
    type: "spotify:callback",
    code: "authorization-code",
    error: null,
    state: new URL(popup.location.href).searchParams.get("state"),
  };
}

async function startLogin() {
  fetchMock.mockResolvedValueOnce(
    Response.json({ clientId: "public-client-id" }),
  );
  const connecting = connectSpotify();
  await vi.waitFor(() =>
    expect(popup.location.href).toContain("accounts.spotify.com/authorize"),
  );
  return { connecting };
}

async function connect(expiresIn = 3600) {
  const { connecting } = await startLogin();
  fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: "memory-token",
      token_type: "Bearer",
      expires_in: expiresIn,
    }),
  );
  send(callback());
  await connecting;
}

beforeEach(() => {
  listeners = new Set();
  popup = {
    closed: false,
    location: { href: "about:blank" },
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  browser = makeBrowser();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("window", browser);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", fetchMock);
  hooks.effects.length = 0;
  hooks.status.textContent = "";
  disconnectSpotify();
});

afterEach(() => {
  disconnectSpotify();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Spotify popup connection", () => {
  it("opens synchronously, validates the callback boundary once, and exchanges a valid PKCE proof", async () => {
    const { connecting } = await startLogin();
    expect(browser.open).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      expect.any(String),
    );
    expect(browser.open.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
    const authorize = new URL(popup.location.href);
    expect(authorize.searchParams.get("scope")).toBe(
      "user-modify-playback-state user-read-playback-state",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${origin}/spotify/callback`,
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    send(callback(), "https://attacker.example");
    send(callback(), origin, {});
    send({ ...callback(), state: "wrong-state" });
    send({ ...callback(), code: 123 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isSpotifyConnected()).toBe(false);

    fetchMock.mockResolvedValueOnce(
      Response.json({
        access_token: "memory-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    send(callback());
    send(callback());
    await connecting;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const exchange = fetchMock.mock.calls[1];
    expect(exchange?.[0]).toBe("https://accounts.spotify.com/api/token");
    const body = exchange?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams))
      throw new Error("Expected token form");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("client_id")).toBe("public-client-id");
    expect(body.has("client_secret")).toBe(false);
    const verifier = body.get("code_verifier");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const digest = await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier ?? ""),
    );
    expect(authorize.searchParams.get("code_challenge")).toBe(
      Buffer.from(digest).toString("base64url"),
    );
    expect(isSpotifyConnected()).toBe(true);
    expect(popup.close).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    disconnectSpotify();
    expect(isSpotifyConnected()).toBe(false);
  });

  it("reports blocked popups before making any request", async () => {
    vi.stubGlobal("window", { ...browser, open: () => null });
    await expect(connectSpotify()).rejects.toMatchObject({
      code: "popup_blocked",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes the popup when the public client ID is missing", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ clientId: null }));
    await expect(connectSpotify()).rejects.toMatchObject({ code: "config" });
    expect(popup.close).toHaveBeenCalled();
    expect(isSpotifyConnected()).toBe(false);
  });

  it("rejects denied authorization without a token exchange", async () => {
    const { connecting } = await startLogin();
    const rejection = expect(connecting).rejects.toMatchObject({
      code: "authorization",
    });
    send({ ...callback(), code: null, error: "access_denied" });
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("rejects a closed popup and cleans up its listener", async () => {
    const { connecting } = await startLogin();
    const rejection = expect(connecting).rejects.toMatchObject({
      code: "popup_closed",
    });
    popup.closed = true;
    await rejection;
    expect(listeners.size).toBe(0);
  });

  it("cancels an outstanding login on disconnect", async () => {
    const { connecting } = await startLogin();
    const rejection = expect(connecting).rejects.toMatchObject({
      code: "cancelled",
    });
    disconnectSpotify();
    await rejection;
    expect(isSpotifyConnected()).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("does not reconnect if disconnected while the token request is pending", async () => {
    const { connecting } = await startLogin();
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    send(callback());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const rejection = expect(connecting).rejects.toMatchObject({
      code: "cancelled",
    });
    disconnectSpotify();
    finish(
      Response.json({
        access_token: "late-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    await rejection;
    expect(isSpotifyConnected()).toBe(false);
  });

  it("rejects malformed token responses", async () => {
    const { connecting } = await startLogin();
    fetchMock.mockResolvedValueOnce(
      Response.json({ access_token: "token", expires_in: "3600" }),
    );
    const rejection = expect(connecting).rejects.toMatchObject({
      code: "token_exchange",
    });
    send(callback());
    await rejection;
    expect(isSpotifyConnected()).toBe(false);
  });
});

describe("Spotify queue", () => {
  it("requires a connection and a verified track URI", async () => {
    await expect(addToQueue(uri)).rejects.toMatchObject({ code: "reconnect" });
    await expect(
      addToQueue("https://open.spotify.com/track/something"),
    ).rejects.toMatchObject({ code: "invalid_uri" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the encoded URI using only the in-memory bearer token", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await addToQueue(uri);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer memory-token" },
      }),
    );
  });

  it.each([
    [
      404,
      "no_active_device",
      "Open Spotify on any device and press play, then tap Add to queue.",
    ],
    [
      403,
      "premium_required",
      "Queueing needs a Spotify Premium account on this app's allowlist.",
    ],
    [
      429,
      "rate_limited",
      "Spotify is busy. Wait a little, then tap Add to queue again.",
    ],
  ])(
    "reports %i without disconnecting or retrying",
    async (status, code, message) => {
      await connect();
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      await expect(addToQueue(uri)).rejects.toMatchObject({ code, message });
      expect(isSpotifyConnected()).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it("clears rejected tokens and asks for reconnection", async () => {
    await connect();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(addToQueue(uri)).rejects.toMatchObject({ code: "reconnect" });
    expect(isSpotifyConnected()).toBe(false);
    await expect(addToQueue(uri)).rejects.toMatchObject({ code: "reconnect" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("expires the connection without attempting to queue", async () => {
    await connect(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1001);
    expect(isSpotifyConnected()).toBe(false);
    await expect(addToQueue(uri)).rejects.toMatchObject({ code: "reconnect" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warns of an unknown outcome on network errors without retrying", async () => {
    await connect();
    fetchMock.mockRejectedValueOnce(new TypeError("Network failure"));
    await expect(addToQueue(uri)).rejects.toMatchObject({
      code: "unknown_outcome",
      message: expect.stringContaining("may already be queued"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out a queue request with an unknown outcome and no retry", async () => {
    await connect();
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          );
        }),
    );
    const result = expect(addToQueue(uri)).rejects.toMatchObject({
      code: "unknown_outcome",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Spotify callback page", () => {
  function runCallback(search: string) {
    browser.location.search = search;
    SpotifyCallbackPage();
    for (const effect of hooks.effects) effect();
  }

  it("strips the query before relaying the code to the exact origin", () => {
    runCallback("?code=private-code&state=state-value");
    expect(browser.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/spotify/callback",
    );
    expect(browser.opener.postMessage).toHaveBeenCalledWith(
      {
        type: "spotify:callback",
        code: "private-code",
        state: "state-value",
        error: null,
      },
      origin,
    );
    expect(
      browser.history.replaceState.mock.invocationCallOrder[0],
    ).toBeLessThan(browser.opener.postMessage.mock.invocationCallOrder[0]);
    expect(hooks.status.textContent).toContain("main window");
    for (const effect of hooks.effects) effect();
    expect(browser.opener.postMessage).toHaveBeenCalledTimes(1);
  });

  it("relays denied authorization and shows failure text", () => {
    runCallback("?error=access_denied&state=state-value");
    expect(browser.opener.postMessage).toHaveBeenCalledWith(
      {
        type: "spotify:callback",
        code: null,
        state: "state-value",
        error: "access_denied",
      },
      origin,
    );
    expect(hooks.status.textContent).toContain("not completed");
  });

  it("strips malformed callbacks and shows recovery text without posting", () => {
    runCallback("?code=private-code");
    expect(browser.history.replaceState).toHaveBeenCalled();
    expect(browser.opener.postMessage).not.toHaveBeenCalled();
    expect(hooks.status.textContent).toContain("connect Spotify again");
  });
});
