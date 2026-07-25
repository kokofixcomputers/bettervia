import { useMemo, useState } from "react";
import { KEYCODE_GROUPS, buildLayerKeycodes } from "../data/keycodes";
import type { Keycode, KeycodeGroup } from "../data/keycodes";

interface KeycodePickerProps {
  layerCount: number;
  customGroup: KeycodeGroup | null;
  onPick: (keycode: Keycode) => void;
  disabled: boolean;
}

export default function KeycodePicker({
  layerCount,
  customGroup,
  onPick,
  disabled,
}: KeycodePickerProps) {
  const groups = useMemo(() => {
    const g = [...KEYCODE_GROUPS, buildLayerKeycodes(layerCount)];
    if (customGroup) g.push(customGroup);
    return g;
  }, [layerCount, customGroup]);

  const [activeGroup, setActiveGroup] = useState(groups[0].id);
  const [query, setQuery] = useState("");

  const current = groups.find((g) => g.id === activeGroup) ?? groups[0];
  const filtered = query.trim()
    ? current.keycodes.filter(
        (k) =>
          k.label.toLowerCase().includes(query.toLowerCase()) ||
          k.name.toLowerCase().includes(query.toLowerCase()) ||
          k.title.toLowerCase().includes(query.toLowerCase()),
      )
    : current.keycodes;

  return (
    <div className={"keycode-picker" + (disabled ? " keycode-picker--disabled" : "")}>
      <div className="pill-tabs">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={"pill-tab" + (g.id === activeGroup ? " pill-tab--active" : "")}
            onClick={() => setActiveGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <input
        className="pill-input"
        placeholder="Search keycodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="keycode-grid">
        {filtered.map((k) => (
          <button
            key={k.code + k.name}
            type="button"
            className="key-pill key-pill--picker"
            title={k.title}
            disabled={disabled}
            onClick={() => onPick(k)}
          >
            <span className="key-pill__label">{k.label || k.name.replace(/^KC_/, "")}</span>
          </button>
        ))}
        {filtered.length === 0 && <div className="keycode-grid__empty">No matches</div>}
      </div>
    </div>
  );
}
