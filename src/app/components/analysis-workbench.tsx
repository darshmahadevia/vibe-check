"use client";

import type { ReactNode, Ref } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  PARAMS,
  PARAM_ENDS,
  PARAM_LABELS,
  type Param,
  type RankedCandidate,
  type Recommendation,
} from "@/lib/mood";

const axisColors = {
  energy: "#d99771",
  positivity: "#b6be8c",
  tempo: "#c5b387",
  texture: "#9fafaa",
  space: "#9aa9be",
  nostalgia: "#ba9dba",
} satisfies Record<Param, string>;

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
  color: string;
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
      color: axisColors[param],
    };
  });
}

function radarPoint(index: number, value: number) {
  const angle = -Math.PI / 2 + (index * Math.PI) / 3;
  const radius = (value / 10) * 118;
  return {
    x: 220 + Math.cos(angle) * radius,
    y: 190 + Math.sin(angle) * radius,
  };
}

function radarPolygon(values: number[]) {
  return values.map((value, index) => {
    const point = radarPoint(index, value);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function ProfileRadar({ rows, song }: { rows: AxisRow[]; song: RankedCandidate }) {
  const reducedMotion = useReducedMotion();
  const transition = { duration: reducedMotion ? 0 : 0.22 };
  return (
    <figure className="profile-radar">
      <svg viewBox="0 0 440 380" role="img" aria-labelledby="radar-title radar-description">
        <title id="radar-title">Photo compared with {song.title}</title>
        <desc id="radar-description">
          Six estimated mood axes on the same 0 to 10 scale. Solid ember circles represent the photo.
          Dashed sage diamonds represent the song. {rows.map((row) => `${row.label}, photo ${row.photo}, song ${row.song}.`).join(" ")}
        </desc>
        <g aria-hidden="true">
          {[2, 4, 6, 8, 10].map((level) => (
            <polygon className="radar-grid" key={level} points={radarPolygon(rows.map(() => level))} />
          ))}
          {rows.map((row, index) => {
            const end = radarPoint(index, 10);
            return <line className="radar-spoke" key={row.param} x1="220" y1="190" x2={end.x} y2={end.y} />;
          })}
          <polygon className="radar-photo" points={radarPolygon(rows.map((row) => row.photo))} />
          <motion.polygon
            className="radar-song"
            initial={false}
            animate={{ points: radarPolygon(rows.map((row) => row.song)) }}
            transition={transition}
          />
          {rows.map((row, index) => {
            const photo = radarPoint(index, row.photo);
            const songPoint = radarPoint(index, row.song);
            const label = radarPoint(index, 13.5);
            return (
              <g key={row.param}>
                <circle className="radar-photo-dot" cx={photo.x} cy={photo.y} r="4" />
                <motion.path
                  className="radar-song-dot"
                  initial={false}
                  animate={{ d: `M ${songPoint.x} ${songPoint.y - 6} l 6 6 -6 6 -6 -6 Z` }}
                  transition={transition}
                />
                <text className="radar-axis-label" x={label.x} y={label.y - 3} textAnchor="middle">{row.label}</text>
                <text className="radar-axis-values" x={label.x} y={label.y + 17} textAnchor="middle">
                  <tspan className="photo-ink">{row.photo}</tspan>
                  <tspan className="radar-separator"> / </tspan>
                  <tspan className="song-ink">{row.song}</tspan>
                </text>
              </g>
            );
          })}
          {[0, 5, 10].map((value) => (
            <text className="radar-scale" key={value} x="229" y={190 - value * 11.8 + 4}>{value}</text>
          ))}
        </g>
      </svg>
      <figcaption className="chart-legend">
        <span><i className="photo-key" aria-hidden="true" />Photo</span>
        <span><i className="song-key" aria-hidden="true" />Song</span>
        <span className="chart-scale">Shared scale 0–10</span>
      </figcaption>
    </figure>
  );
}

function WeightDistribution({ rows, reason }: { rows: AxisRow[]; reason: string }) {
  return (
    <section className="weight-distribution" aria-labelledby="weights-title">
      <h3 id="weights-title">What mattered most</h3>
      <p>{reason}</p>
      <div className="weight-strip" aria-hidden="true">
        {rows.map((row) => (
          <span key={row.param} style={{ width: `${row.weight * 100}%`, background: row.color }} />
        ))}
      </div>
      <div className="weight-legend">
        {rows.map((row) => (
          <div className="weight-row" key={row.param}>
            <span className="axis-key" style={{ background: row.color }} aria-hidden="true" />
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
}: {
  recommendation: Recommendation;
  selectedId: RankedCandidate["id"] | null;
  onSelect: (id: RankedCandidate["id"]) => void;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <section className="candidate-ranking" aria-labelledby="ranking-title">
      <div className="ranking-heading">
        <h3 id="ranking-title">All eight candidates</h3>
        <span>Similarity</span>
      </div>
      <p>Choose a song to compare. Your queue stays as it is.</p>
      <ol className="candidates">
        {recommendation.candidates.map((song) => (
          <li key={song.id}>
            <button
              type="button"
              className="candidate"
              aria-pressed={selectedId === song.id}
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
            <a className="spotify-link" href={song.resolution.url} target="_blank" rel="noopener noreferrer">Open in Spotify</a>
          </li>
        ))}
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
          <div className="axis-impact"><span>Gap {row.gap} / 10</span><span>{number.format(row.penalty)} match points lost</span></div>
        </section>
      ))}
    </div>
  );
}

export function AnalysisWorkbench({
  recommendation,
  selectedId,
  onSelect,
  detailsRef,
  children,
}: {
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
        <div className="profile-overview">
          <section aria-labelledby="profile-title">
            <h3 id="profile-title">The shape of the match</h3>
            <p className="compared-song">Comparing <strong>{song.title}</strong> <span>by {song.artist}</span></p>
            <ProfileRadar rows={rows} song={song} />
          </section>
          <WeightDistribution rows={rows} reason={recommendation.weights_reason} />
        </div>
        <CandidateRanking recommendation={recommendation} selectedId={selectedId} onSelect={onSelect} />
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
