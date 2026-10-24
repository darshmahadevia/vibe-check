"use client";

import { useEffect, useRef } from "react";

export default function SpotifyCallbackPage() {
  const handled = useRef(false);
  const status = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const report = (message: string) => {
      if (status.current) status.current.textContent = message;
    };
    if (!window.opener || !state || (!code && !error)) {
      report("Spotify login could not finish. Return to the main window and connect Spotify again.");
      return;
    }
    try {
      window.opener.postMessage({ type: "spotify:callback", code, state, error }, window.location.origin);
      report(error
        ? "Spotify login was not completed. Return to the main window to try again."
        : "Login returned to the main window. You can close this window and check your Spotify connection there.");
    } catch {
      report("Spotify login could not reach the main window. Close this window and connect Spotify again.");
    }
  }, []);

  return (
    <main>
      <h1>Spotify connection</h1>
      <p ref={status} role="status" aria-live="polite">Completing Spotify login...</p>
    </main>
  );
}
