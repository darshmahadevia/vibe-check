"use client";

import type { ReactNode, Ref } from "react";
import type { QueueState } from "../page";
import { motion, useReducedMotion } from "motion/react";
import {
  PARAMS,
  PARAM_ENDS,
  PARAM_LABELS,
  type Param,
  type RankedCandidate,
  type Recommendation,
} from "@/lib/mood";

type AxisRow = {
  param: Param;
  label: string;
  ends: (typeof PARAM_ENDS)[Param];
  photo: number;
  song: number;
  evidence: string;
  weight: number;
  gap: number;
  penalty: number;
};

function comparisonRows({
  recommendation,
  song,
}: {
  recommendation: Recommendation;
  song: RankedCandidate;
}): AxisRow[] {
  return PARAMS.map((param) => {
    const photo = recommendation.photo_profile[param];
    const gap = Math.abs(photo.score - song.profile[param]);
    const weight = recommendation.weights[param];
    return {
      param,
      label: PARAM_LABELS[param],
      ends: PARAM_ENDS[param],
      photo: photo.score,
      song: song.profile[param],
      evidence: photo.evidence,
      weight,
      gap,
      penalty: 10 * weight * gap,
    };
  });
}

function WeightDistribution({ rows, reason }: { rows: AxisRow[]; reason: string }) {
  return (
    <section className="weight-distribution" aria-labelledby="weights-title">
      <h3 id="weights-title">What mattered most</h3>
      <p>{reason}</p>
      <div className="weight-legend">
        {rows.map((row) => (
          <div className="weight-row" key={row.param}>
            <span>{row.label}</span>
            <span>{(row.weight * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CandidateRanking({
  recommendation,
  selectedId,
  onSelect,
  queue,
}: {
  queue: QueueControls;
  recommendation: Recommendation;
  selectedId: RankedCandidate["id"] | null;
  onSelect: (id: RankedCandidate["id"]) => void;
}) {
  const reducedMotion = useReducedMotion();
  const available = recommendation.candidates.some((song) =>
    song.resolution.kind === "verified" &&
    !queue.queues[`${recommendation.requestId}:${song.id}`]);
  const retryable = recommendation.candidates.some((song) =>
    song.resolution.kind === "verified" &&
    queue.queues[`${recommendation.requestId}:${song.id}`]?.kind === "error");
  return (
    <section className="candidate-ranking" aria-labelledby="ranking-title">
      <div className="ranking-heading">
        <h3 id="ranking-title">Curate your queue</h3>
        <span>Similarity</span>
      </div>
      <p>Select songs for Spotify. They’ll be added in ranked order. Choose a title to compare its mood.</p>
      <div className="batch-controls">
        <div className="batch-selection-actions">
          <button className="secondary" disabled={queue.queueBusy || (!available && !retryable)} onClick={queue.onSelectAvailable}>Select available</button>
          <button className="secondary" disabled={queue.queueBusy || !queue.queueSelection.size} onClick={queue.onClearQueue}>Clear</button>
        </div>
        <button disabled={queue.queueBusy || !queue.queueSelection.size} onClick={queue.onQueueSelected}>
          {queue.queueBusy ? "Preparing your queue…" : `${queue.connected ? "Add selected" : "Connect & add selected"} (${queue.queueSelection.size})`}
        </button>
      </div>
      <ol className="candidates">
        {recommendation.candidates.map((song) => {
          const state = queue.queues[`${recommendation.requestId}:${song.id}`];
          const added = state?.kind === "added" || (state && state.confirmed);
          const unavailable = song.resolution.kind !== "verified";
          return (
          <li key={song.id} data-queue-state={state?.kind}>
            <label className="queue-choice">
              <input type="checkbox" aria-label={`Select ${song.title} by ${song.artist} for queue`}
                checked={queue.queueSelection.has(song.id)}
                disabled={queue.queueBusy || unavailable || !!added || state?.kind === "adding"}
                onChange={() => queue.onToggleQueue(song.id)} />
            </label>
            <button
              type="button"
              className="candidate"
              aria-pressed={selectedId === song.id}
              aria-label={`Compare ${song.title} by ${song.artist}`}
              onClick={() => onSelect(song.id)}
            >
              <span className="rank">{song.rank}</span>
              <span className="song-name">
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
                <small>
                  {song.resolution.kind === "verified" ? "Verified on Spotify" : "Not verified"}
                  {song.id === recommendation.winnerId && <span className="winner-badge">Winner</span>}
                </small>
              </span>
              <strong className="candidate-score">{song.score}%</strong>
              <span className="candidate-track" aria-hidden="true">
                <motion.span
                  initial={false}
                  animate={{ scaleX: song.score / 100 }}
                  transition={{ duration: reducedMotion ? 0 : 0.2 }}
                />
              </span>
            </button>
            <div className="candidate-footer">
              <span className="candidate-queue-status" role="status">
                {added ? "Queued" : state?.kind === "adding" ? "Adding…" : state?.kind === "error" ? state.message : unavailable ? "Unavailable for queueing" : queue.queueSelection.has(song.id) ? "Selected for queue" : ""}
              </span>
            <a className="spotify-link" href={song.resolution.url} target="_blank" rel="noopener noreferrer">Open in Spotify</a>
            </div>
          </li>
        );})}
      </ol>
    </section>
  );
}

function PreciseComparison({ rows }: { rows: AxisRow[] }) {
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="precise-comparison">
      {rows.map((row) => (
        <section className="mood-row" key={row.param} aria-labelledby={`axis-${row.param}`}>
          <div className="bar-label">
            <h4 id={`axis-${row.param}`}>{row.label}</h4>
            <div className="paired-values">
              <span className="photo-ink">Photo <strong>{row.photo}</strong></span>
              <span className="song-ink">Song <strong>{row.song}</strong></span>
            </div>
          </div>
          <div className="paired-track">
            <meter min={0} max={10} value={row.photo} aria-label={`${row.label} photo score`} />
            <span className="gap-link" aria-hidden="true" style={{ left: `${Math.min(row.photo, row.song) * 10}%`, width: `${row.gap * 10}%` }} />
            <span className="photo-marker" aria-hidden="true" style={{ left: `${row.photo * 10}%` }} />
            <span className="song-marker" aria-hidden="true" style={{ left: `${row.song * 10}%` }} />
          </div>
          <div className="bar-ends"><span>0 · {row.ends[0]}</span><span>{row.ends[1]} · 10</span></div>
          <p>{row.evidence}</p>
          <div className="axis-impact"><span>Gap {row.gap} / 10</span><span>{number.format(row.penalty)} points from match</span></div>
        </section>
      ))}
    </div>
  );
}

type QueueControls = {
  queueSelection: Set<number>;
  queues: Record<string, QueueState>;
  queueBusy: boolean;
  connected: boolean;
  onToggleQueue: (id: number) => void;
  onSelectAvailable: () => void;
  onClearQueue: () => void;
  onQueueSelected: () => void;
};

export function AnalysisWorkbench({
  recommendation,
  selectedId,
  onSelect,
  detailsRef,
  children,
  ...queue
}: QueueControls & {
  recommendation: Recommendation;
  selectedId: RankedCandidate["id"] | null;
  onSelect: (id: RankedCandidate["id"]) => void;
  detailsRef: Ref<HTMLDetailsElement>;
  children: ReactNode;
}) {
  const song = recommendation.candidates.find((candidate) => candidate.id === selectedId);
  if (!song) return null;
  const rows = comparisonRows({ recommendation, song });
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  return (
    <section className="analysis-workbench" aria-labelledby="analysis-title">
      <div className="analysis-heading">
        <h2 id="analysis-title">Inside the match</h2>
        <p>Six mood estimates. Eight songs. A closer look at why they fit.</p>
      </div>
      <div className="analysis-overview">
        <CandidateRanking recommendation={recommendation} selectedId={selectedId} onSelect={onSelect} queue={queue} />
      </div>
      <section className="selected-comparison" aria-labelledby="comparison-title">
        <div className="comparison-heading">
          <div>
            <h3 id="comparison-title">{song.title}, parameter by parameter</h3>
            <p>{song.fit_note}</p>
          </div>
          <span className="comparison-label">{song.id === recommendation.winnerId ? "Comparing the winner" : "Comparing an alternative"}</span>
        </div>
        <p className="comparison-guide">Ember circles show the photo. Sage diamonds show the song. A smaller gap is a closer fit.</p>
        <PreciseComparison rows={rows} />
        {children}
      </section>
      <WeightDistribution rows={rows} reason={recommendation.weights_reason} />
      <details ref={detailsRef} open className="analysis-detail">
        <summary>How we decided</summary>
        <p className="formula">
          Match = round(100 × (1 − weighted average gap ÷ 10)). Higher is closer.
          Each axis costs 10 × weight × gap match points. Ties favor verified songs, then the smallest worst gap.
        </p>
        <div className="comparison-wrap">
          <table>
            <caption>Photo vs. {song.title}. Scores share a 0–10 scale. Weights and match points are rounded for display.</caption>
            <thead><tr><th scope="col">Parameter</th><th scope="col">Photo</th><th scope="col">Song</th><th scope="col">Gap</th><th scope="col">Weight</th><th scope="col">Points lost</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.param}><th scope="row">{row.label}</th><td>{row.photo}</td><td>{row.song}</td><td>{row.gap}</td><td>{(row.weight * 100).toFixed(1)}%</td><td>{number.format(row.penalty)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
