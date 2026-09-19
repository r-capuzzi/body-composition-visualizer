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
    <div className="field" role="radiogroup" aria-labelledby="activity-level-heading">
      <label id="activity-level-heading">
        Activity level — your typical week, including all exercise
      </label>

      {ACTIVITY_LEVELS.map((level) => {
        const selected = level.value === value;
        const id = `activity-${level.value}`;
        return (
          // The whole card is the <label> so clicking anywhere on it selects
          // the radio. That also makes the card's ENTIRE text the radio's
          // accessible name by default - every example, read out on every
          // arrow-key press - so the radio names itself from just the level
          // and takes the multiplier + summary as a description instead.
          <label
            key={level.value}
            className={"activity-option" + (selected ? " selected" : "")}
          >
            <input
              type="radio"
              name="activity_level"
              value={level.value}
              checked={selected}
              onChange={() => onChange(level.value)}
              aria-labelledby={`${id}-name`}
              aria-describedby={`${id}-mult ${id}-summary`}
              style={{ marginRight: "0.5rem" }}
            />
            <span className="head">
              <span id={`${id}-name`}>{level.label}</span>
              <span className="mult" id={`${id}-mult`}>×{level.multiplier}</span>
            </span>
            <p className="summary" id={`${id}-summary`}>{level.summary}</p>
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
