"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import Image from "next/image";
import Link from "next/link";
import { PARAMS, PARAM_ENDS, PARAM_LABELS, recommendationSchema, type RankedCandidate, type Recommendation } from "@/lib/mood";
import { preparePhoto, type PreparedPhoto } from "@/lib/browser/photo";
import { addToQueue, connectSpotify, disconnectSpotify, isSpotifyConnected } from "@/lib/browser/spotify";

type PhotoState = { kind: "empty" } | { kind: "preparing" } | { kind: "ready"; photo: PreparedPhoto };
type ResultState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; result: Recommendation };
type QueueState = { kind: "adding" } | { kind: "added" } | { kind: "error"; message: string };
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

function Comparison({ result, song }: { result: Recommendation; song: RankedCandidate }) {
  return <div className="comparison-wrap"><table><caption>Photo vs. {song.title}</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Photo</th><th scope="col">Song</th><th scope="col">Gap</th></tr></thead><tbody>{PARAMS.map(p => <tr key={p}><th scope="row">{PARAM_LABELS[p]}</th><td>{result.photo_profile[p].score}</td><td>{song.profile[p]}</td><td>{song.gaps[p]}</td></tr>)}</tbody></table></div>;
}

export default function Home() {
  const [photo, setPhoto] = useState<PhotoState>({ kind: "empty" });
  const [result, setResult] = useState<ResultState>({ kind: "idle" });
  const [inputError, setInputError] = useState("");
  const [connection, setConnection] = useState<"disconnected" | "connecting" | "connected">("disconnected");
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

  useEffect(() => () => { controller.current?.abort(); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => { if (details.current) details.current.open = window.matchMedia("(min-width: 768px)").matches; }, [result]);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    const current = ++generation.current;
    controller.current?.abort();
    resultRef.current = null;
    setResult({ kind: "idle" }); setInputError(""); setPhoto({ kind: "preparing" }); setSelected(null);
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; }
    try {
      const prepared = await preparePhoto(file);
      if (current !== generation.current) { URL.revokeObjectURL(prepared.preview); return; }
      previewUrl.current = prepared.preview;
      setPhoto({ kind: "ready", photo: prepared });
    } catch (error) {
      if (current !== generation.current) return;
      setPhoto({ kind: "empty" }); setInputError(error instanceof Error ? error.message : "That file didn't work. Try a JPEG or PNG.");
    }
  }
  async function queueSong(recommendation: Recommendation, song: RankedCandidate, automatic = false) {
    if (song.resolution.kind !== "verified") return;
    const key = `${recommendation.requestId}:${song.id}`;
    if (queueLocks.current.has(key)) return;
    if (automatic && automaticAttempts.current.has(recommendation.requestId)) return;
    if (automatic) automaticAttempts.current.add(recommendation.requestId);
    queueLocks.current.add(key);
    setQueues(previous => ({ ...previous, [key]: { kind: "adding" } }));
    try {
      await addToQueue(song.resolution.uri);
      setQueues(previous => ({ ...previous, [key]: { kind: "added" } }));
    } catch (error) {
      setQueues(previous => ({ ...previous, [key]: { kind: "error", message: error instanceof Error ? error.message : "Couldn't add this song. Please try again." } }));
      if (!isSpotifyConnected()) setConnection("disconnected");
    } finally { queueLocks.current.delete(key); }
  }
  async function connect(queueTarget?: RankedCandidate) {
    const pendingGeneration = generation.current;
    const pendingRequestId = resultRef.current?.requestId;
    setConnection("connecting"); setConnectionError("");
    try {
      await connectSpotify(); setConnection("connected");
      const current = resultRef.current;
      if (pendingGeneration !== generation.current) return;
      if (queueTarget && current?.requestId !== pendingRequestId) return;
      const targetId = queueTarget?.id ?? current?.winnerId;
      const winner = current?.candidates.find(c => c.id === targetId);
      if (current && winner) await queueSong(current, winner, !queueTarget);
    } catch (error) {
      setConnection("disconnected"); setConnectionError(error instanceof Error ? error.message : "Couldn't connect. Please try again.");
    }
  }
  async function findSong() {
    if (photo.kind !== "ready" || result.kind === "loading") return;
    const current = ++generation.current;
    resultRef.current = null;
    const abort = new AbortController(); controller.current = abort;
    setResult({ kind: "loading" });
    try {
      const form = new FormData(); form.set("photo", photo.photo.blob, "photo.jpg");
      const response = await fetch("/api/recommend", { method: "POST", body: form, signal: abort.signal, cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = errorSchema.safeParse(body);
        throw new Error(failure.success ? failure.data.error.message : "Something went wrong. Please try again.");
      }
      const recommendation = recommendationSchema.parse(body);
      if (current !== generation.current) return;
      resultRef.current = recommendation;
      setResult({ kind: "ready", result: recommendation }); setSelected(recommendation.winnerId ?? recommendation.candidates[0]?.id ?? null);
      const winner = recommendation.candidates.find(c => c.id === recommendation.winnerId);
      if (winner && isSpotifyConnected()) await queueSong(recommendation, winner, true);
    } catch (error) {
      if (abort.signal.aborted || current !== generation.current) return;
      setResult({ kind: "error", message: error instanceof z.ZodError ? "Couldn't read the result. Please try again." : error instanceof Error ? error.message : "Something went wrong. Please try again." });
    }
  }
  function reset() {
    ++generation.current; controller.current?.abort(); resultRef.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null; setPhoto({ kind: "empty" }); setResult({ kind: "idle" }); setInputError(""); setSelected(null); setQueues({});
    upload.current?.focus();
  }
  const recommendation = result.kind === "ready" ? result.result : null;
  const winner = recommendation?.candidates.find(c => c.id === recommendation.winnerId);
  const comparison = recommendation?.candidates.find(c => c.id === selected);
  const winnerQueue = winner && recommendation ? queues[`${recommendation.requestId}:${winner.id}`] : undefined;

  const comparisonQueue = comparison && recommendation ? queues[`${recommendation.requestId}:${comparison.id}`] : undefined;

  return <main>
    <header><Link href="/" className="wordmark">Vibe Check</Link><div className="connection"><button className="secondary" onClick={connection === "connected" ? () => { disconnectSpotify(); setConnection("disconnected"); } : () => connect()} disabled={connection === "connecting"}>{connection === "connecting" ? "Connecting…" : connection === "connected" ? "Disconnect Spotify" : "Connect Spotify"}</button><small>{connection === "connected" ? "Connected for queueing" : "No login needed to find a song"}</small></div></header>
    {connectionError && <p role="alert" className="error">{connectionError}</p>}
    <section className="intro"><h1>Find the song for this moment.</h1><p>Take or upload a photo. Gemma 4 reads the mood. We match the songs and show the math.</p></section>
    <section aria-label="Choose a photo" className="photo-section" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void choosePhoto(event.dataTransfer.files[0]); }}>
      <input ref={camera} className="file-input" type="file" accept="image/*" capture="environment" aria-label="Take a photo" onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={upload} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload a photo" onChange={event => { void choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
      {photo.kind === "ready" ? <div className="photo-preview"><Image unoptimized src={photo.photo.preview} width={photo.photo.width} height={photo.photo.height} alt="Your selected photo" /></div> : <div className="empty-photo"><p>{photo.kind === "preparing" ? "Preparing your photo…" : "Start with a photo"}</p><span>JPEG, PNG, or WebP. You can also drop a file here.</span></div>}
      <div className="actions"><button className="secondary" onClick={() => camera.current?.click()}>Take a photo</button><button className="secondary" onClick={() => upload.current?.click()}>Upload a photo</button><button onClick={findSong} disabled={photo.kind !== "ready" || result.kind === "loading"}>{result.kind === "loading" ? "Finding your song…" : "Find my song"}</button></div>
      <p className="privacy">Your photo is used once to pick songs and is never saved.</p>
      {inputError && <p role="alert" className="error">{inputError}</p>}
    </section>
    <div aria-live="polite" aria-atomic="true">{result.kind === "loading" && <p className="loading">Reading the photo, matching eight songs, and checking Spotify. This can take a moment.</p>}</div>
    {result.kind === "error" && <p role="alert" className="error">{result.message}</p>}
    {recommendation && <section className="results" aria-label="Your song results">
      <p className="vibe-summary">{recommendation.vibe_summary}</p>
      {winner ? <section className="winner" aria-labelledby="winner-title"><div className="winner-heading"><div><h2 id="winner-title">{winner.resolution.kind === "verified" ? winner.resolution.title : winner.title}</h2><p>{winner.resolution.kind === "verified" ? winner.resolution.artist : winner.artist}</p></div><strong>{winner.score}% match</strong></div><p>{winner.fit_note}</p>
        {winner.resolution.kind === "verified" && <iframe title={`Spotify player for ${winner.title}`} src={`https://open.spotify.com/embed/track/${winner.resolution.trackId}`} width="100%" height="152" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />}
        <div className="queue-status" aria-live="polite">{winnerQueue?.kind === "added" ? <p>Added to your Spotify queue.</p> : <><p>{winnerQueue?.kind === "error" ? winnerQueue.message : connection === "connected" ? "Your highest-ranked verified song." : "Connect Spotify to add this to your queue."}</p><button disabled={winnerQueue?.kind === "adding" || connection === "connecting"} onClick={() => connection === "connected" ? queueSong(recommendation, winner) : connect(winner)}>{winnerQueue?.kind === "adding" ? "Adding to queue…" : connection === "connected" ? "Add to queue" : "Connect Spotify to add to queue"}</button></>}</div>
        {winner.rank > 1 && <p className="fallback-note">#1 wasn&apos;t found on Spotify, so {winnerQueue?.kind === "added" ? "we queued" : "we selected"} #{winner.rank}.</p>}
      </section> : <div className="notice"><h2>No verified Spotify match</h2><p>We couldn&apos;t verify these songs on Spotify. Your ranked suggestions are below. Use their search links to find them. Nothing was queued.</p></div>}
      <details ref={details} open><summary>How we decided</summary><div className="breakdown"><section><h3>The photo&apos;s mood</h3><div className="mood-grid">{PARAMS.map(p => <div className="mood-row" key={p}><div className="bar-label"><strong>{PARAM_LABELS[p]}</strong><span>{recommendation.photo_profile[p].score} / 10</span></div><meter min={0} max={10} value={recommendation.photo_profile[p].score} aria-label={`${PARAM_LABELS[p]} photo score`} /><div className="bar-ends"><span>{PARAM_ENDS[p][0]}</span><span>{PARAM_ENDS[p][1]}</span></div><p>{recommendation.photo_profile[p].evidence}</p></div>)}</div></section>
        <section><h3>What mattered most</h3><p>{recommendation.weights_reason}</p><div className="weights">{PARAMS.map(p => <div className="weight-row" key={p}><span>{PARAM_LABELS[p]}</span><div className="weight-track"><span style={{ width: `${recommendation.weights[p] * 100}%` }} /></div><span>{(recommendation.weights[p] * 100).toFixed(1)}%</span></div>)}</div><p className="formula">Match = round(100 × (1 − weighted average gap ÷ 10)). Higher is closer. Ties favor verified songs, then the smallest worst gap.</p></section>
        <section><h3>All eight candidates</h3><p>Select a song to compare its parameters with the photo.</p><ol className="candidates">{recommendation.candidates.map(song => <li key={song.id}><button className="candidate" aria-pressed={selected === song.id} onClick={() => setSelected(song.id)}><span className="rank">{song.rank}</span><span className="song-name"><strong>{song.title}</strong><span>{song.artist}</span><small>{song.resolution.kind === "verified" ? "Verified on Spotify" : "Not verified"}{song.id === recommendation.winnerId ? " · Selected song" : ""}</small></span><strong>{song.score}%</strong></button><a className="spotify-link" href={song.resolution.url} target="_blank" rel="noopener noreferrer">Open in Spotify</a></li>)}</ol></section>
        {comparison && <section className="selected-comparison"><h3>{comparison.id === recommendation.winnerId ? "The winner, parameter by parameter" : `Compare ${comparison.title}`}</h3><p>{comparison.fit_note}</p><Comparison result={recommendation} song={comparison} />{comparison.id !== recommendation.winnerId && comparison.resolution.kind === "verified" && <><button disabled={comparisonQueue?.kind === "adding"} onClick={() => connection === "connected" ? queueSong(recommendation, comparison) : connect(comparison)}>{connection === "connected" ? "Add to queue instead" : "Connect Spotify to queue songs"}</button><p aria-live="polite">{comparisonQueue?.kind === "added" ? "Added to your Spotify queue." : comparisonQueue?.kind === "error" ? comparisonQueue.message : ""}</p></>}</section>}
      </div></details>
      <p className="disclaimer">Song scores are Gemma 4&apos;s estimates of how each song sounds, not measured audio data.</p><button className="secondary" onClick={reset}>Try another photo</button>
    </section>}
    <footer><span>Gemma reads the mood. Code makes the match.</span><span>Queue mode needs Spotify Premium and an allowlisted account. Connecting enables automatic queueing.</span></footer>
  </main>;
}
