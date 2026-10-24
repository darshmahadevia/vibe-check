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
