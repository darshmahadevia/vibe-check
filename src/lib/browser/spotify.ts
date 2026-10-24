import { z } from "zod";

const configSchema = z.object({ clientId: z.string().trim().min(1).nullable() });
const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().toLowerCase().pipe(z.literal("bearer")),
  expires_in: z.number().finite().positive(),
});
const callbackSchema = z.object({
  type: z.literal("spotify:callback"),
  state: z.string(),
  code: z.string().nullable(),
  error: z.string().nullable(),
});

type Token = { value: string; expiresAt: number };
let token: Token | null = null;
let login: { cancel: () => void } | null = null;

export class SpotifyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SpotifyError";
  }
}

function reconnectError() {
  return new SpotifyError("reconnect", "Reconnect Spotify, then tap Add to queue.");
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isSpotifyConnected(): boolean {
  if (token && token.expiresAt <= Date.now()) token = null;
  return token !== null;
}

export function disconnectSpotify(): void {
  token = null;
  login?.cancel();
}

export function connectSpotify(): Promise<void> {
  if (login) return Promise.reject(new SpotifyError("connecting", "Spotify login is already open."));
  const popup = window.open("about:blank", "_blank", "popup,width=480,height=720");
  if (!popup) return Promise.reject(new SpotifyError("popup_blocked", "Allow popups, then connect Spotify again."));

  const controller = new AbortController();
  const attempt = { cancel: () => controller.abort() };
  login = attempt;
  const origin = window.location.origin;
  const redirectUri = `${origin}/spotify/callback`;
  let cleanup = () => {};

  return (async () => {
    try {
      const configResponse = await request("/api/spotify/config", { cache: "no-store", signal: controller.signal });
      if (!configResponse.ok) throw new SpotifyError("config", "Spotify configuration is unavailable. Try connecting again.");
      const config = configSchema.safeParse(await configResponse.json());
      if (!config.success || !config.data.clientId) throw new SpotifyError("config", "Spotify is not configured for this app.");
      const clientId = config.data.clientId;
      const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
      const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      controller.signal.throwIfAborted();

      const code = await new Promise<string>((resolve, reject) => {
        const onMessage = (event: MessageEvent<unknown>) => {
          if (event.origin !== origin || event.source !== popup) return;
          const parsed = callbackSchema.safeParse(event.data);
          if (!parsed.success || parsed.data.state !== state) return;
          cleanup();
          if (parsed.data.error || !parsed.data.code) {
            reject(new SpotifyError("authorization", "Spotify login was not completed. Connect again when you're ready."));
          } else {
            resolve(parsed.data.code);
          }
        };
        const onAbort = () => {
          cleanup();
          reject(new SpotifyError("cancelled", "Spotify connection was cancelled."));
        };
        const poll = setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(new SpotifyError("popup_closed", "Spotify login was closed. Connect again when you're ready."));
          }
        }, 500);
        const deadline = setTimeout(() => {
          cleanup();
          reject(new SpotifyError("login_timeout", "Spotify login timed out. Connect again."));
        }, 180_000);
        cleanup = () => {
          window.removeEventListener("message", onMessage);
          controller.signal.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(deadline);
        };
        window.addEventListener("message", onMessage);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        const authorize = new URL("https://accounts.spotify.com/authorize");
        authorize.search = new URLSearchParams({
          response_type: "code", client_id: clientId, redirect_uri: redirectUri,
          scope: "user-modify-playback-state user-read-playback-state",
          code_challenge_method: "S256", code_challenge: challenge, state,
        }).toString();
        popup.location.href = authorize.toString();
      });

      popup.close();
      const response = await request("https://accounts.spotify.com/api/token", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
      });
      if (!response.ok) throw new SpotifyError("token_exchange", "Spotify could not connect. Please connect again.");
      const parsed = tokenSchema.safeParse(await response.json());
      if (!parsed.success) throw new SpotifyError("token_exchange", "Spotify returned an invalid login response. Please connect again.");
      controller.signal.throwIfAborted();
      token = { value: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
    } catch (error) {
      if (error instanceof SpotifyError) throw error;
      if (controller.signal.aborted) throw new SpotifyError("cancelled", "Spotify connection was cancelled.");
      throw new SpotifyError("connection", "Could not connect to Spotify. Check your connection and try again.");
    } finally {
      cleanup();
      popup.close();
      if (login === attempt) login = null;
    }
  })();
}

export async function addToQueue(uri: string): Promise<void> {
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) throw new SpotifyError("invalid_uri", "Choose a verified Spotify track to add to the queue.");
  if (!isSpotifyConnected() || !token) throw reconnectError();
  const activeToken = token;
  let response: Response;
  try {
    response = await request(`https://api.spotify.com/v1/me/player/queue?${new URLSearchParams({ uri })}`, {
      method: "POST", headers: { Authorization: `Bearer ${activeToken.value}` },
    });
  } catch {
    throw new SpotifyError("unknown_outcome", "Spotify did not confirm the request. The song may already be queued. Check your queue before trying again.");
  }
  if (response.ok) return;
  if (response.status === 401) {
    if (token === activeToken) token = null;
    throw reconnectError();
  }
  if (response.status === 404) throw new SpotifyError("no_active_device", "Open Spotify on any device and press play, then tap Add to queue.");
  if (response.status === 403) throw new SpotifyError("premium_required", "Queueing needs a Spotify Premium account on this app's allowlist.");
  if (response.status === 429) throw new SpotifyError("rate_limited", "Spotify is busy. Wait a little, then tap Add to queue again.");
  throw new SpotifyError("queue_failed", "Spotify could not add the song. Try Add to queue again later.");
}
