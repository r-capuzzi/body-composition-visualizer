import { ACTIVITY_LEVELS } from "../lib/activityLevels";

/**
 * Radio-group of activity levels, each card showing its multiplier and concrete
 * examples so the user can classify themselves accurately.
 *
 * Props:
 *   value    - the currently selected activity value ("moderate", ...)
 *   onChange - called with the new value string when the user picks a card
 *
 * This is a "controlled" component: it holds no state of its own. The parent
 * owns `value` and updates it via `onChange`. That keeps a single source of
 * truth for the whole form.
 */
export default function ActivityPicker({ value, onChange }) {
  return (
    <div className="field">
      <label>Activity level — your typical week, including all exercise</label>

      {ACTIVITY_LEVELS.map((level) => {
        const selected = level.value === value;
        return (
          <label
            key={level.value}
            className={"activity-option" + (selected ? " selected" : "")}
          >
            {/* The actual radio input is visually minimal but keeps the group
                keyboard-accessible and behaving like a real radio group. */}
            <input
              type="radio"
              name="activity_level"
              value={level.value}
              checked={selected}
              onChange={() => onChange(level.value)}
              style={{ marginRight: "0.5rem" }}
            />
            <span className="head">
              <span>{level.label}</span>
              <span className="mult">×{level.multiplier}</span>
            </span>
            <p className="summary">{level.summary}</p>
            <ul>
              {level.examples.map((ex) => (
                <li key={ex}>{ex}</li>
              ))}
            </ul>
          </label>
        );
      })}
    </div>
  );
}
