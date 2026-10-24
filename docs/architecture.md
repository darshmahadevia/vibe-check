# Base app architecture

The browser prepares a JPEG and posts it to `/api/recommend`. The route validates the image, calls Gemma, searches Spotify, ranks the candidates, and returns a recommendation. The browser renders that result and uses its own PKCE token to queue the verified winner.

`src/lib/mood.ts` owns the authoritative schemas, six parameter keys, defaults, normalization, gaps, and pure ranking. Candidate resolutions form a verified or unverified union. Only verified tracks carry a queue URI.

Server-only Gemma and Spotify adapters own provider response validation and credentials. The route is their only coordinator. Browser photo and Spotify modules own image conversion and OAuth respectively. No database, service framework, preference system, or background jobs are needed.

## Synthesis decision

Two independent design candidates and a cross-judge agreed on the thin route, pure ranker, two concrete server adapters, and browser helpers. Candidate 1 supplied the base module boundaries. Candidate 2 reinforced keeping orchestration in its sole caller. Both candidates drifted from the explicit brief on parameter names, scale, and defaults. Those suggestions were rejected. The implementation uses the brief's exact six keys and integer 0–10 scores, clamps scores, floors raw weights at .05, normalizes, and ranks by rounded scores. The judge's suggestion to reject clamping and omit manual queue retries was also rejected because the brief explicitly requires both.

The last tie-break compares the largest individual gap. Remaining ties preserve candidate input order. A verified winner may rank below an unverified suggestion. If none is verified, the result has no queue winner and preserves all eight search links.

OAuth uses a popup to preserve the in-memory photo and result during login. Tokens and verifier remain in browser memory. Reload disconnects Spotify. There is one automatic queue attempt per result. A network failure has an unknown outcome, so only a deliberate manual action retries it.
