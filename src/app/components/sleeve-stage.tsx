"use client";

import Image from "next/image";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Resolution } from "@/lib/mood";

export type QueuedSong = Pick<
  Extract<Resolution, { kind: "verified" }>,
  "title" | "artist" | "albumCoverUrl"
> & { id: string };

type StageDisc =
  | { kind: "photo"; id: string; preview: string }
  | ({ kind: "queued" } & QueuedSong);

function QueuedArtwork({ song, thumbnail = false }: { song: QueuedSong; thumbnail?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = song.albumCoverUrl;
  return (
    <span className="queued-artwork">
      {cover && failedUrl !== cover ? (
        <Image
          src={cover}
          alt=""
          fill
          unoptimized
          sizes={thumbnail ? "80px" : "(max-width: 600px) 90vw, 440px"}
          onError={() => setFailedUrl(cover)}
        />
      ) : (
        <span className="artwork-fallback">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 9l11-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <ellipse cx="6" cy="18" rx="3" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
            <ellipse cx="17" cy="16" rx="3" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {!thumbnail && <><strong>{song.title}</strong><span>{song.artist}</span></>}
        </span>
      )}
    </span>
  );
}

export function SleeveStage({
  photoPreview,
  queuedSongs,
}: {
  photoPreview: string;
  queuedSongs: QueuedSong[];
}) {
  const reducedMotion = useReducedMotion();
  const photo: StageDisc = { kind: "photo", id: `photo:${photoPreview}`, preview: photoPreview };
  const [selectedId, setSelectedId] = useState(photo.id);
  const discs: StageDisc[] = [
    photo,
    ...queuedSongs.map((song): StageDisc => ({ kind: "queued", ...song })),
  ];
  const selected = discs.find((disc) => disc.id === selectedId) ?? photo;

  return (
    <section className="sleeve-stage" aria-label="Your photo and queued songs">
      <figure className="selected-artwork">
        <motion.div
          className="artwork-display"
          key={selected.id}
          initial={{ opacity: reducedMotion ? 1 : 0.65 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          aria-hidden="true"
        >
          {selected.kind === "photo" ? (
            <Image src={selected.preview} alt="" fill unoptimized sizes="(max-width: 600px) 90vw, 440px" />
          ) : (
            <QueuedArtwork song={selected} />
          )}
        </motion.div>
        <figcaption className="artwork-caption" aria-live="polite" aria-atomic="true">
          <div>
            <strong>{selected.kind === "photo" ? "Your moment" : selected.title}</strong>
            <span>{selected.kind === "photo" ? "Your photo. Your soundtrack starts here." : selected.artist}</span>
          </div>
          {selected.kind === "queued" && <span className="artwork-status">Added to your queue</span>}
        </figcaption>
      </figure>
      <div className="artwork-library">
        <p>{queuedSongs.length ? "Your photo. The songs you queued." : "Your photo. A soundtrack waiting to happen."}</p>
        <div className="artwork-selector" role="group" aria-label="Choose artwork to view">
          {discs.map((disc) => (
            <button
              key={disc.id}
              type="button"
              className="artwork-choice"
              aria-label={disc.kind === "photo" ? "View your photo" : `View ${disc.title} by ${disc.artist}, added to your queue`}
              aria-pressed={selected.id === disc.id}
              onClick={() => setSelectedId(disc.id)}
            >
              <span className="artwork-thumbnail" aria-hidden="true">
                {disc.kind === "photo" ? (
                  <Image src={disc.preview} alt="" fill unoptimized sizes="80px" />
                ) : (
                  <QueuedArtwork song={disc} thumbnail />
                )}
              </span>
              <span className="artwork-choice-title">{disc.kind === "photo" ? "Your moment" : disc.title}</span>
              <span className="artwork-choice-detail">{disc.kind === "photo" ? "Your photo" : disc.artist}</span>
            </button>
          ))}
        </div>
        {queuedSongs.length > 0 && <small>Choose a cover to see it in full.</small>}
      </div>
    </section>
  );
}
