# Base app implementation

The acceptance check is a photo upload producing eight ranked candidates, visible evidence and weights, a verified winner when Spotify search succeeds, and one browser queue request when connected.

1. Scaffold Next.js and confirm the placeholder runs. Prepare Vercel deployment without publishing until the concrete build is reviewable.
2. Define the six-parameter model and ranking. Test score extremes, normalization, invalid weights, gaps, and tie breaking.
3. Implement the Gemma boundary with inline image data, schema validation, one invalid-output retry, no logging, and explicit quota errors.
4. Implement parallel Spotify searches and token caching. Test failure fallbacks and winner selection.
5. Implement image preparation, upload and camera inputs, results, PKCE, and queue errors.
6. Run the production build and the browser flow at desktop and mobile widths. Document setup and verified limitations.

Throughput checkpoint. Work stays in one checkout. Two design candidates write only isolated temporary documents. Implementation follows the chosen contract. Verification uses deterministic external-service responses until real credentials are configured. No measured throughput target is claimed.

Privacy wins over raw-response logging. Photos and model output must never be persisted or logged by this app. Provider processing policies are separate and must be disclosed in the README.

The brief's base-first instruction limits visual work to a functional, accessible layout. New interaction concepts and additional features are deferred.

## Verification at the base implementation

- The production app returns HTTP 200 without authentication at `https://vibe-check-three-nu.vercel.app`.
- 65 tests pass across ranking, image decoding, Gemma validation/retry, route behavior, Spotify search, and browser PKCE/queue handling.
- ESLint, TypeScript, and the production Next.js build pass.
- The browser smoke expression passes 19 checks at 1280px and 390px, locally and against the deployment with a controlled recommendation response.
- Independent review found two stale OAuth queue-intent bugs. Both were fixed, and a fresh follow-up review reported no unresolved lifecycle findings.
- T3's screenshot operation timed out on the Spotify iframe twice. Documentation captures use a separate headless Chrome session through Playwright. UI behavior was also checked through the T3 browser.
- The app's actual deployed recommendation endpoint returns the explicit no-configuration 503 and `Cache-Control: no-store` when given a valid synthetic JPEG without `GEMINI_API_KEY`.

Live acceptance remains NOT VERIFIED. The Vercel project needs `GEMINI_API_KEY`, `SPOTIFY_CLIENT_ID`, and `SPOTIFY_CLIENT_SECRET`. The Premium teammate must register the exact callback URL, connect, and have an active Spotify device. No live model response or queue delivery is claimed.

The functional base uses the user's requested minimal layout. Visual refinement remains deferred. The design detector's only finding was the default Arial font, which is intentionally retained for this base.

A rapid double click initially failed the browser check by sending two requests. The active AbortController now locks submission synchronously. The updated check passes on the deployed app. `GEMMA_MODEL=gemma-4-26b-a4b-it` is configured in Vercel Production. The three service credentials remain absent.
