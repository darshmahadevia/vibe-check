"use client";

import Image from "next/image";
import { useState, type PointerEvent } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import type { Resolution } from "@/lib/mood";

export type QueuedSong = Pick<
  Extract<Resolution, { kind: "verified" }>,
  "title" | "artist" | "albumCoverUrl"
> & { id: string };

type StageDisc =
  | { kind: "photo"; id: string; preview: string }
  | ({ kind: "queued" } & QueuedSong);

type SleeveInteraction =
  | { kind: "rest"; inspected: string | null }
  | {
      kind: "exploring";
      source: "pointer" | "keyboard";
      id: string;
      inspected: string | null;
    };

function QueuedArtwork({ song }: { song: QueuedSong }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`sleeve-art artwork-queued${song.albumCoverUrl && !failed ? " has-cover" : ""}`}>
      {song.albumCoverUrl && !failed ? (
        <Image src={song.albumCoverUrl} alt="" fill unoptimized sizes="250px" onError={() => setFailed(true)} />
      ) : (
        <>
          <span className="art-edition">ADDED TO YOUR QUEUE</span>
          <strong>{song.title}</strong>
          <span className="art-subtitle">{song.artist}</span>
        </>
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
  const [interaction, setInteraction] = useState<SleeveInteraction>({
    kind: "rest",
    inspected: null,
  });
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(pointerX, { stiffness: 140, damping: 24, mass: 0.7 });
  const rotateY = useSpring(pointerY, { stiffness: 140, damping: 24, mass: 0.7 });
  const discs: StageDisc[] = [
    ...queuedSongs.map((song): StageDisc => ({ kind: "queued", ...song })),
    { kind: "photo", id: `photo:${photoPreview}`, preview: photoPreview },
  ];
  const activeId = interaction.kind === "exploring" ? interaction.id : null;
  const captionId = activeId ?? interaction.inspected;
  const inspected = discs.find((disc) => disc.id === captionId);
  const caption =
    inspected?.kind === "queued"
      ? `${inspected.title} · ${inspected.artist} · Added to your queue.`
      : inspected?.kind === "photo"
        ? "Your moment · Your photo takes the front."
        : queuedSongs.length > 0
          ? "Your photo. The songs you queued."
          : "Your photo. Your soundtrack starts here.";

  function explore(id: string, source: "pointer" | "keyboard") {
    setInteraction((previous) => ({
      kind: "exploring",
      source,
      id,
      inspected: previous.inspected,
    }));
  }

  function stopExploring(source: "pointer" | "keyboard") {
    setInteraction((previous) =>
      previous.kind === "exploring" && previous.source === source
        ? { kind: "rest", inspected: previous.inspected }
        : previous,
    );
  }

  function moveFan(event: PointerEvent<HTMLElement>) {
    if (
      reducedMotion ||
      event.pointerType === "touch" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    pointerX.set(-y * 4);
    pointerY.set(x * 4);
  }

  return (
    <motion.figure
      className="sleeve-stage"
      data-has-queued={queuedSongs.length > 0}
      initial={{ opacity: 0, filter: reducedMotion ? "none" : "blur(6px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: reducedMotion ? 0.15 : 0.55 }}
      onPointerMove={moveFan}
      onPointerLeave={() => {
        pointerX.set(0);
        pointerY.set(0);
        stopExploring("pointer");
      }}
    >
      <div className="stage-light" aria-hidden="true" />
      <div className="sleeve-canvas">
        <motion.div
          className="sleeve-fan"
          initial={false}
          animate={{ x: queuedSongs.length > 0 ? 0 : 100, y: queuedSongs.length > 0 ? 0 : -55 }}
          transition={{ duration: reducedMotion ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{
            rotateX: reducedMotion ? 0 : rotateX,
            rotateY: reducedMotion ? 0 : rotateY,
          }}
        >
          <div className="sleeve-floor" aria-hidden="true" />
          <AnimatePresence initial={false}>
            {discs.map((disc, index) => {
              const active = activeId === disc.id;
              const position = queuedSongs.length <= 1 ? 0 : index / (queuedSongs.length - 1);
              const isPhoto = disc.kind === "photo";
              return (
                <motion.div
                  className={`sleeve-slot${isPhoto ? " front-slot" : ""}`}
                  key={disc.id}
                  data-disc-kind={disc.kind}
                  layout={reducedMotion ? false : "position"}
                  initial={isPhoto || reducedMotion ? { opacity: 0 } : { x: -36, y: 35, opacity: 0 }}
                  animate={{
                    x: 0,
                    y: 0,
                    opacity: 1,
                    left: isPhoto ? 45 : 112 + 164 * position,
                    top: isPhoto ? 173 : 119 - 95 * position,
                    rotateX: 8,
                    rotateY: -24,
                    rotateZ: isPhoto ? -16 : -25 + 12 * position,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.65, opacity: { duration: reducedMotion ? 0.15 : 0.65 }, ease: [0.16, 1, 0.3, 1] }}
                  style={{ zIndex: active ? 12 : isPhoto ? 10 : queuedSongs.length - index }}
                >
                  <button
                    type="button"
                    className="sleeve-trigger"
                    data-disc-kind={disc.kind}
                    aria-label={isPhoto ? "Inspect your photo sleeve" : `Inspect ${disc.title} by ${disc.artist}, added to your queue`}
                    aria-pressed={interaction.inspected === disc.id}
                    data-active={active}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch" && window.matchMedia("(hover: hover) and (pointer: fine)").matches)
                        explore(disc.id, "pointer");
                    }}
                    onPointerLeave={() => stopExploring("pointer")}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(":focus-visible")) explore(disc.id, "keyboard");
                    }}
                    onBlur={() => stopExploring("keyboard")}
                    onClick={() => setInteraction((previous) => ({ ...previous, inspected: disc.id }))}
                  >
                    <motion.span
                      className="sleeve-lift"
                      animate={{
                        y: active && !reducedMotion ? -52 : 0,
                        rotateZ: active && !reducedMotion ? 6 : 0,
                        z: active && !reducedMotion ? 32 : 0,
                      }}
                      transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <span className={`sleeve-case${isPhoto ? " front-case" : ""}`} aria-hidden="true">
                        {disc.kind === "photo" ? (
                          <span className="sleeve-art artwork-front">
                            <span className="sleeve-photo">
                              <Image src={disc.preview} alt="" fill unoptimized sizes="280px" />
                            </span>
                            <span className="front-lettering has-photo">
                              <span className="art-edition">VIBE CHECK / YOUR MOMENT</span>
                              <strong>THIS FEELS LIKE YOU.</strong>
                              <span className="art-subtitle">A soundtrack waiting to happen.</span>
                            </span>
                          </span>
                        ) : (
                          <QueuedArtwork song={disc} />
                        )}
                      </span>
                    </motion.span>
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>
      <figcaption>
        <span className="sleeve-caption" aria-live="polite">{caption}</span>
        <small>Hover to explore. Tap a sleeve to inspect.</small>
      </figcaption>
    </motion.figure>
  );
}
