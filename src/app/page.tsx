"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import Image from "next/image";
import Link from "next/link";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import { SleeveStage, type QueuedSong } from "./components/sleeve-stage";
import { AnalysisWorkbench } from "./components/analysis-workbench";
import {
  recommendationSchema,
  type RankedCandidate,
  type Recommendation,
} from "@/lib/mood";
import { preparePhoto, type PreparedPhoto } from "@/lib/browser/photo";
import {
  isPhotoDrag,
  loadBrowserPhoto,
  parsePhotoDrop,
  type PhotoDrop,
} from "@/lib/browser/photo-drop";
import {
  addToQueue,
  connectSpotify,
  disconnectSpotify,
  isSpotifyConnected,
} from "@/lib/browser/spotify";

export type PhotoState =
  | { kind: "empty" }
  | { kind: "preparing" }
  | { kind: "ready"; photo: PreparedPhoto };
export type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: Recommendation };
type QueueState =
  | { kind: "adding"; confirmed: boolean }
  | { kind: "added" }
  | { kind: "error"; message: string; confirmed: boolean };
function hasQueueConfirmation(state: QueueState | undefined): boolean {
  if (!state) return false;
  return state.kind === "added" || state.confirmed;
}
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

export default function Home() {
  const reducedMotion = useReducedMotion();
  const [photo, setPhoto] = useState<PhotoState>({ kind: "empty" });
  const [result, setResult] = useState<ResultState>({ kind: "idle" });
  const [inputError, setInputError] = useState("");
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepth = useRef(0);
  const [connection, setConnection] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [connectionError, setConnectionError] = useState("");
  const [queues, setQueues] = useState<Record<string, QueueState>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const queueLocks = useRef(new Set<string>());
  const automaticAttempts = useRef(new Set<string>());
  const resultRef = useRef<Recommendation | null>(null);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!fileDragActive) return;
    const clearDrag = () => {
      fileDragDepth.current = 0;
      setFileDragActive(false);
    };
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag();
    };
    window.addEventListener("keydown", cancelDrag);
    window.addEventListener("blur", clearDrag);
    return () => {
      window.removeEventListener("keydown", cancelDrag);
      window.removeEventListener("blur", clearDrag);
    };
  }, [fileDragActive]);

  useEffect(
    () => () => {
      ++generation.current;
      controller.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (details.current)
      details.current.open = window.matchMedia("(min-width: 768px)").matches;
  }, [result]);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    await acceptPhoto({ kind: "file", file });
  }
  async function acceptPhoto(source: Exclude<PhotoDrop, { kind: "not-image" }>) {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout =
      source.kind === "image-url"
        ? window.setTimeout(() => abort.abort(), 20_000)
        : undefined;
    resultRef.current = null;
    setResult({ kind: "idle" });
    setInputError("");
    setPhoto({ kind: "preparing" });
    setSelected(null);
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    try {
      if (source.kind === "unsupported-image") throw new Error(source.message);
      const file =
        source.kind === "file"
          ? source.file
          : await loadBrowserPhoto({ url: source.url, signal: abort.signal });
      window.clearTimeout(timeout);
      const prepared = await preparePhoto(file);
      if (current !== generation.current) {
        URL.revokeObjectURL(prepared.preview);
        return;
      }
      previewUrl.current = prepared.preview;
      setPhoto({ kind: "ready", photo: prepared });
    } catch (error) {
      if (current !== generation.current) return;
      setPhoto({ kind: "empty" });
      setInputError(
        error instanceof Error
          ? error.message
          : "That file didn't work. Try a JPEG or PNG.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
    }
  }
  async function queueSong(
    recommendation: Recommendation,
    song: RankedCandidate,
    automatic = false,
  ) {
    if (song.resolution.kind !== "verified") return;
    const key = `${recommendation.requestId}:${song.id}`;
    if (queueLocks.current.has(key)) return;
    if (automatic && automaticAttempts.current.has(recommendation.requestId))
      return;
    if (automatic) automaticAttempts.current.add(recommendation.requestId);
    queueLocks.current.add(key);
    setQueues((previous) => ({
      ...previous,
      [key]: { kind: "adding", confirmed: hasQueueConfirmation(previous[key]) },
    }));
    try {
      await addToQueue(song.resolution.uri);
      setQueues((previous) => ({ ...previous, [key]: { kind: "added" } }));
    } catch (error) {
      setQueues((previous) => ({
        ...previous,
        [key]: {
          kind: "error",
          confirmed: hasQueueConfirmation(previous[key]),
          message:
            error instanceof Error
              ? error.message
              : "Couldn't add this song. Please try again.",
        },
      }));
      if (!isSpotifyConnected()) setConnection("disconnected");
    } finally {
      queueLocks.current.delete(key);
    }
  }
  async function connect(queueTarget?: RankedCandidate) {
    const pendingGeneration = generation.current;
    const pendingRequestId = resultRef.current?.requestId;
    setConnection("connecting");
    setConnectionError("");
    try {
      await connectSpotify();
      setConnection("connected");
      const current = resultRef.current;
      if (pendingGeneration !== generation.current) return;
      if (queueTarget && current?.requestId !== pendingRequestId) return;
      const targetId = queueTarget?.id ?? current?.winnerId;
      const winner = current?.candidates.find((c) => c.id === targetId);
      if (current && winner) await queueSong(current, winner, !queueTarget);
    } catch (error) {
      setConnection("disconnected");
      setConnectionError(
        error instanceof Error
          ? error.message
          : "Couldn't connect. Please try again.",
      );
    }
  }
  async function findSong() {
    if (
      photo.kind !== "ready" ||
      result.kind === "loading" ||
      controller.current
    )
      return;
    const current = ++generation.current;
    resultRef.current = null;
    const abort = new AbortController();
    controller.current = abort;
    setResult({ kind: "loading" });
    try {
      const form = new FormData();
      form.set("photo", photo.photo.blob, "photo.jpg");
      const response = await fetch("/api/recommend", {
        method: "POST",
        body: form,
        signal: abort.signal,
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = errorSchema.safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.error.message
            : "Something went wrong. Please try again.",
        );
      }
      const recommendation = recommendationSchema.parse(body);
      if (current !== generation.current) return;
      resultRef.current = recommendation;
      setResult({ kind: "ready", result: recommendation });
      setSelected(
        recommendation.winnerId ?? recommendation.candidates[0]?.id ?? null,
      );
      const winner = recommendation.candidates.find(
        (c) => c.id === recommendation.winnerId,
      );
      if (winner && isSpotifyConnected())
        await queueSong(recommendation, winner, true);
    } catch (error) {
      if (abort.signal.aborted || current !== generation.current) return;
      setResult({
        kind: "error",
        message:
          error instanceof z.ZodError
            ? "Couldn't read the result. Please try again."
            : error instanceof Error
              ? error.message
              : "Something went wrong. Please try again.",
      });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }
  function reset() {
    ++generation.current;
    controller.current?.abort();
    controller.current = null;
    resultRef.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPhoto({ kind: "empty" });
    setResult({ kind: "idle" });
    setInputError("");
    setSelected(null);
    setQueues({});
    upload.current?.focus();
  }
  const recommendation = result.kind === "ready" ? result.result : null;
  const queuedSongs: QueuedSong[] = Array.from(
    new Map(
      recommendation?.candidates.flatMap((song) => {
        const id = `${recommendation.requestId}:${song.id}`;
        return song.resolution.kind === "verified" && hasQueueConfirmation(queues[id])
          ? [
              [
                id,
                { id, title: song.resolution.title, artist: song.resolution.artist },
              ] satisfies [string, QueuedSong],
            ]
          : [];
      }),
    ).values(),
  );
  const winner = recommendation?.candidates.find(
    (c) => c.id === recommendation.winnerId,
  );
  const comparison = recommendation?.candidates.find((c) => c.id === selected);
  const winnerQueue =
    winner && recommendation
      ? queues[`${recommendation.requestId}:${winner.id}`]
      : undefined;

  const comparisonQueue =
    comparison && recommendation
      ? queues[`${recommendation.requestId}:${comparison.id}`]
      : undefined;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22 }}>
      <div
        className="page-drop-zone"
        data-file-drag-active={fileDragActive}
        onDragEnter={(event) => {
          if (!isPhotoDrag(event.dataTransfer)) return;
          event.preventDefault();
          fileDragDepth.current += 1;
          setFileDragActive(true);
        }}
        onDragOver={(event) => {
          if (!isPhotoDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
          if (fileDragDepth.current === 0) setFileDragActive(false);
        }}
        onDragEnd={() => {
          fileDragDepth.current = 0;
          setFileDragActive(false);
        }}
        onDrop={(event) => {
          fileDragDepth.current = 0;
          setFileDragActive(false);
          const drop = parsePhotoDrop(event.dataTransfer);
          if (drop.kind === "not-image") return;
          event.preventDefault();
          void acceptPhoto(drop);
        }}
      >
        {fileDragActive && (
          <div className="file-drop-feedback" role="status">
            <span>Drop your photo here</span>
          </div>
        )}
      <main>
        <header className="site-header">
          <Link href="/" className="wordmark">
            <svg
              className="brand-mark"
              width="26"
              height="26"
              viewBox="0 0 26 26"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 11v4m5-9v14m5-17v20m5-17v14m5-9v4"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            Vibe Check
          </Link>
          <div className="connection">
            <button
              className="secondary"
              onClick={
                connection === "connected"
                  ? () => {
                      disconnectSpotify();
                      setConnection("disconnected");
                    }
                  : () => connect()
              }
              disabled={connection === "connecting"}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M6 9c4-1.5 8-1.2 12 1M7 12c3.5-1 6.5-.7 10 1M8 15c2.5-.6 5-.3 8 1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>
                {connection === "connecting"
                  ? "Connecting…"
                  : connection === "connected"
                    ? "Disconnect Spotify"
                    : "Connect Spotify"}
              </span>
            </button>
            <small>
              {connection === "connected"
                ? "Connected for queueing"
                : "No login needed to find a song"}
            </small>
          </div>
        </header>
        {connectionError && (
          <p role="alert" className="error">
            {connectionError}
          </p>
        )}
        <div className="workbench" data-has-photo={photo.kind === "ready"}>
          <motion.section layout={reducedMotion ? false : "position"} className="intro">
            <h1>Every moment has a soundtrack.</h1>
            <p>
              A late night. A slow morning. A feeling you can’t quite name.
              Start with a photo. Find the song that fits.
            </p>
          </motion.section>
          {photo.kind === "ready" && (
            <SleeveStage
              key={photo.photo.preview}
              photoPreview={photo.photo.preview}
              queuedSongs={queuedSongs}
            />
          )}
          <motion.section
            layout={reducedMotion ? false : "position"}
            aria-label="Choose a photo"
            className="photo-section"
          >
            <input
              ref={camera}
              className="file-input"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take a photo"
              onChange={(event) => {
                void choosePhoto(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={upload}
              className="file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload a photo"
              onChange={(event) => {
                void choosePhoto(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <motion.div
              key={photo.kind}
              className="photo-status"
              initial={{
                opacity: 0.4,
                filter: reducedMotion ? "none" : "blur(4px)",
              }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
            >
              {photo.kind === "ready" ? (
                <>
                  <div className="photo-preview">
                    <Image
                      unoptimized
                      src={photo.photo.preview}
                      width={photo.photo.width}
                      height={photo.photo.height}
                      alt="Your selected photo"
                    />
                  </div>
                  <div className="photo-copy">
                    <strong>Your moment, ready to play.</strong>
                    <span>Choose a different photo anytime.</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="photo-placeholder" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                      <path
                        d="m3 17 5-5 4 4 4-6 5 7"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="empty-photo photo-copy">
                    <strong>
                      {photo.kind === "preparing"
                        ? "Preparing your photo…"
                        : "It starts with your photo."}
                    </strong>
                    <span>Drop a JPEG, PNG, or WebP here.</span>
                  </div>
                </>
              )}
            </motion.div>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => upload.current?.click()}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Upload a photo
              </button>
              <button
                className="secondary"
                onClick={() => camera.current?.click()}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m8 5 1-2h6l1 2h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                Take a photo
              </button>
              <motion.button
                className="find-song"
                onClick={findSong}
                disabled={photo.kind !== "ready" || result.kind === "loading"}
                whileTap={reducedMotion ? undefined : { scale: 0.985 }}
              >
                {result.kind === "loading"
                  ? "Finding your song…"
                  : "Find my song"}
              </motion.button>
            </div>
            <p className="privacy">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="5"
                  y="10"
                  width="14"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M8 10V7a4 4 0 0 1 8 0v3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
              Used once to find your songs. Never saved.
            </p>
            {inputError && (
              <p role="alert" className="error">
                {inputError}
              </p>
            )}
          </motion.section>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <AnimatePresence initial={false} mode="wait">
            {result.kind === "loading" && (
              <motion.div
                key="loading"
                className="loading"
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className="loading-indicator" aria-hidden="true" />
                <div>
                  <strong>Listening to the feeling.</strong>
                  <p>
                    Reading your photo, matching eight songs, and checking
                    Spotify. This can take a moment.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {result.kind === "error" && (
          <p role="alert" className="error">
            {result.message}
          </p>
        )}
        {recommendation && (
          <motion.section
            key={recommendation.requestId}
            className="results"
            aria-label="Your song results"
            initial={{
              opacity: 0.4,
              y: reducedMotion ? 0 : 12,
              filter: reducedMotion ? "none" : "blur(4px)",
            }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: reducedMotion ? 0.15 : 0.4 }}
          >
            <p className="vibe-summary">{recommendation.vibe_summary}</p>
            {winner ? (
              <section className="winner" aria-labelledby="winner-title">
                <div className="winner-heading">
                  <div>
                    <h2 id="winner-title">
                      {winner.resolution.kind === "verified"
                        ? winner.resolution.title
                        : winner.title}
                    </h2>
                    <p>
                      {winner.resolution.kind === "verified"
                        ? winner.resolution.artist
                        : winner.artist}
                    </p>
                  </div>
                  <strong>{winner.score}% match</strong>
                </div>
                <p>{winner.fit_note}</p>
                {winner.resolution.kind === "verified" && (
                  <iframe
                    title={`Spotify player for ${winner.title}`}
                    src={`https://open.spotify.com/embed/track/${winner.resolution.trackId}`}
                    width="100%"
                    height="152"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                  />
                )}
                <div className="queue-status" aria-live="polite">
                  {winnerQueue?.kind === "added" ? (
                    <p>Added to your Spotify queue.</p>
                  ) : (
                    <>
                      <p>
                        {winnerQueue?.kind === "error"
                          ? winnerQueue.message
                          : connection === "connected"
                            ? "Your highest-ranked verified song."
                            : "Connect Spotify to add this to your queue."}
                      </p>
                      <button
                        disabled={
                          winnerQueue?.kind === "adding" ||
                          connection === "connecting"
                        }
                        onClick={() =>
                          connection === "connected"
                            ? queueSong(recommendation, winner)
                            : connect(winner)
                        }
                      >
                        {winnerQueue?.kind === "adding"
                          ? "Adding to queue…"
                          : connection === "connected"
                            ? "Add to queue"
                            : "Connect Spotify to add to queue"}
                      </button>
                    </>
                  )}
                </div>
                {winner.rank > 1 && (
                  <p className="fallback-note">
                    #1 wasn&apos;t found on Spotify, so{" "}
                    {winnerQueue?.kind === "added"
                      ? "we queued"
                      : "we selected"}{" "}
                    #{winner.rank}.
                  </p>
                )}
              </section>
            ) : (
              <div className="notice">
                <h2>No verified Spotify match</h2>
                <p>
                  We couldn&apos;t verify these songs on Spotify. Your ranked
                  suggestions are below. Use their search links to find them.
                  Nothing was queued.
                </p>
              </div>
            )}
            <AnalysisWorkbench
              recommendation={recommendation}
              selectedId={selected}
              onSelect={setSelected}
              detailsRef={details}
            >
              {comparison &&
                comparison.id !== recommendation.winnerId &&
                comparison.resolution.kind === "verified" && (
                  <div className="comparison-queue">
                    <button
                      disabled={comparisonQueue?.kind === "adding"}
                      onClick={() =>
                        connection === "connected"
                          ? queueSong(recommendation, comparison)
                          : connect(comparison)
                      }
                    >
                      {connection === "connected"
                        ? "Add to queue instead"
                        : "Connect Spotify to queue songs"}
                    </button>
                    <p aria-live="polite">
                      {comparisonQueue?.kind === "added"
                        ? "Added to your Spotify queue."
                        : comparisonQueue?.kind === "error"
                          ? comparisonQueue.message
                          : ""}
                    </p>
                  </div>
                )}
            </AnalysisWorkbench>
            <p className="disclaimer">
              Song scores are Gemma 4&apos;s estimates of how each song sounds,
              not measured audio data.
            </p>
            <button className="secondary" onClick={reset}>
              Try another photo
            </button>
          </motion.section>
        )}
        <footer>
          <span>Gemma reads the mood. Code makes the match.</span>
          <span>
            Queue mode needs Spotify Premium and an allowlisted account.
            Connecting enables automatic queueing.
          </span>
        </footer>
      </main>
      </div>
    </MotionConfig>
  );
}
