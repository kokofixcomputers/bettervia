import type { LayoutKey, ViaLayouts } from "../types/via";

/**
 * Parses the VIA-style KLE keymap array (layouts.keymap) into absolute
 * positioned keys. Follows the same cursor rules as kle-serial:
 * - a modifier object adjusts w/h/x/y (as deltas) for the next key(s)
 * - after each row the cursor resets x to the row's initial x-offset and y += 1
 * - a plain string legend is "row,col" (matrix position) for that key
 */
export function parseKleLayout(layouts: ViaLayouts): LayoutKey[] {
  const keys: LayoutKey[] = [];
  let cursorY = 0;
  let index = 0;

  for (const row of layouts.keymap) {
    let cursorX = 0;
    let w = 1;
    let h = 1;
    let xOffset = 0;

    for (const entry of row) {
      if (typeof entry === "string") {
        const x = cursorX + xOffset;
        const y = cursorY;
        const [rowStr, colStr] = entry.split(",");
        const matrixRow = Number(rowStr);
        const matrixCol = Number(colStr);

        keys.push({
          index: index++,
          row: matrixRow,
          col: matrixCol,
          x,
          y,
          w,
          h,
          labelRaw: entry,
        });

        cursorX += w;
        // reset per-key modifiers after consuming them
        w = 1;
        h = 1;
        xOffset = 0;
      } else {
        // layout modifier object applying to the next key
        if (entry.w !== undefined) w = entry.w;
        if (entry.h !== undefined) h = entry.h;
        if (entry.x !== undefined) xOffset = entry.x;
        // y offsets on individual keys are uncommon in VIA defs; support anyway
        if (entry.y !== undefined) cursorY += entry.y;
      }
    }

    cursorY += 1;
  }

  return keys;
}

export function layoutBounds(keys: LayoutKey[]) {
  let maxX = 0;
  let maxY = 0;
  for (const k of keys) {
    maxX = Math.max(maxX, k.x + k.w);
    maxY = Math.max(maxY, k.y + k.h);
  }
  return { width: maxX, height: maxY };
}

export function emptyKeymap(layers: number, rows: number, cols: number): string[][][] {
  return Array.from({ length: layers }, () =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => "KC_NO")),
  );
}
