import { useMemo } from "react";
import type { LayoutKey } from "../types/via";
import { layoutBounds } from "../lib/kle";
import Key, { UNIT, GAP } from "./Key";
import { keycodeLabel } from "../data/keycodes";
import type { Keycode } from "../data/keycodes";

interface KeyboardProps {
  keys: LayoutKey[];
  /** row,col -> raw numeric keycode value for current layer */
  keycodeAt: (row: number, col: number) => number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  customKeycodes: Keycode[];
}

export default function Keyboard({
  keys,
  keycodeAt,
  selectedIndex,
  onSelect,
  customKeycodes,
}: KeyboardProps) {
  const bounds = useMemo(() => layoutBounds(keys), [keys]);

  return (
    <div
      className="keyboard-surface"
      style={{
        width: bounds.width * UNIT + GAP,
        height: bounds.height * UNIT + GAP,
      }}
    >
      {keys.map((key) => {
        const code = key.row >= 0 && key.col >= 0 ? keycodeAt(key.row, key.col) : 0;
        const label = key.row >= 0 && key.col >= 0 ? keycodeLabel(code, customKeycodes) : "";
        return (
          <Key
            key={key.index}
            x={key.x}
            y={key.y}
            w={key.w}
            h={key.h}
            label={label}
            selected={selectedIndex === key.index}
            isNo={code === 0x0000}
            isTrns={code === 0x0001}
            onClick={() => onSelect(key.index)}
          />
        );
      })}
    </div>
  );
}
