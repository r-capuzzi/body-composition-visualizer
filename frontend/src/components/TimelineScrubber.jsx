import { useEffect, useState } from "react";

/**
 * Slider across the plan's weeks. Dragging it sets `week` in the parent, which
 * re-drives the avatar and every stat. A play button auto-advances it like
 * scrubbing a video.
 *
 * Props:
 *   weeks   - last week index (plan length)
 *   week    - currently selected week (controlled by parent)
 *   setWeek - the parent's state setter (accepts a value or an updater fn)
 */
export default function TimelineScrubber({ weeks, week, setWeek }) {
  const [playing, setPlaying] = useState(false);

  // Stop playing when we reach the end.
  useEffect(() => {
    if (playing && week >= weeks) setPlaying(false);
  }, [playing, week, weeks]);

  // While playing, step forward one week every 130ms. The cleanup clears the
  // interval so a fresh one isn't stacked on top each time this effect re-runs.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () => setWeek((w) => Math.min(w + 1, weeks)),
      130
    );
    return () => clearInterval(id);
  }, [playing, weeks, setWeek]);

  function togglePlay() {
    // restart from the beginning if we're already at the end
    if (!playing && week >= weeks) setWeek(0);
    setPlaying((p) => !p);
  }

  return (
    <div className="scrubber">
      <button
        type="button"
        className="scrubber-play"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play timeline"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <input
        type="range"
        min={0}
        max={weeks}
        step={1}
        value={Math.min(week, weeks)}
        onChange={(e) => setWeek(Number(e.target.value))}
        aria-label="Timeline week"
      />

      <span className="scrubber-label">
        {week === 0
          ? "Now"
          : `Week ${week} · ${Math.round((week / (weeks || 1)) * 100)}%`}
      </span>
    </div>
  );
}
