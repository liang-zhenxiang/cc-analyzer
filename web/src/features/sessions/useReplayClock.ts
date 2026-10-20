import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The replay clock: progress in `[0, 1]` advanced by `requestAnimationFrame`.
 *
 * Why a hook instead of state in the view: the clock has three pieces of
 * housekeeping that must not be re-done per render (the rAF handle, the last
 * frame timestamp, and the visibility listener). Keeping them in one place also
 * makes the "pause when the document is hidden" rule impossible to forget.
 *
 * `resolveProgress` is the one escape hatch: the view uses it to skip long
 * pauses. It runs on every tick *only* — a manual seek still lands exactly
 * where the reader clicked, because a seek is an explicit request for that
 * instant, not playback.
 */
export function useReplayClock({
  durationMs,
  resolveProgress
}: {
  durationMs: number;
  resolveProgress?: (progress: number) => number;
}) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(0);
  const resolverRef = useRef(resolveProgress);
  resolverRef.current = resolveProgress;

  const apply = useCallback((value: number) => {
    const resolved = resolverRef.current ? resolverRef.current(value) : value;
    const clamped = Math.min(1, Math.max(0, resolved));
    progressRef.current = clamped;
    setProgress(clamped);
    return clamped;
  }, []);

  const seek = useCallback((value: number) => {
    // A seek is an explicit request for that instant: it deliberately bypasses
    // the pause resolver so the reader can inspect a pause, not be pushed past
    // it. Only playback ticks skip.
    const next = Math.min(1, Math.max(0, value));
    progressRef.current = next;
    setProgress(next);
    // Landing on the end means the film is over for the same reason a
    // natural finish does; the button must say 「播放」 again, not 「暂停」.
    if (next >= 1) setPlaying(false);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const play = useCallback(() => {
    if (!(durationMs > 0)) return;
    if (progressRef.current >= 1) apply(0);
    setPlaying(true);
  }, [apply, durationMs]);

  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!(durationMs > 0)) return;
    if (progressRef.current >= 1) apply(0);
    setPlaying(true);
  }, [apply, durationMs, playing]);

  useEffect(() => {
    if (!playing) return;
    if (!(durationMs > 0)) {
      setPlaying(false);
      return;
    }

    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last === null) {
        last = now;
        frame = window.requestAnimationFrame(tick);
        return;
      }
      const delta = Math.max(0, now - last);
      last = now;
      const next = apply(progressRef.current + delta / durationMs);
      if (next >= 1) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [apply, durationMs, playing]);

  // Hidden documents do not paint; letting the clock run would make the viewer
  // come back to a different instant than the one they left.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return {
    progress,
    playing,
    /** The film reached its end and stopped there. */
    ended: progress >= 1 && !playing,
    play,
    pause,
    toggle,
    seek
  };
}
