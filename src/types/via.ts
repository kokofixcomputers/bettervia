// Types describing the VIA keyboard "definition" JSON format
// (matches the format used by the official usevia.app / QMK VIA app)

export interface ViaMatrix {
  rows: number;
  cols: number;
}

/** A single entry in a KLE-style keymap row: either a legend string "row,col"
 * or a KLE layout-modifier object ({w, h, x, y, ...}) that applies to the
 * key(s) immediately following it. */
export type KleLayoutModifier = {
  w?: number;
  h?: number;
  x?: number;
  y?: number;
  r?: number;
  rx?: number;
  ry?: number;
};

export type KleRowEntry = string | KleLayoutModifier;

export interface ViaLayouts {
  /** raw KLE-ish keymap, array of rows, each row an array of legend/modifier entries */
  keymap: KleRowEntry[][];
  labels?: string[];
}

export interface ViaMenuRangeOption {
  /** [min, max] */
  0: number;
  1: number;
}

export interface ViaMenuItem {
  label: string;
  type?: "range" | "dropdown" | "toggle" | "color";
  showIf?: string;
  /** [id_string, channel, index] addressing a custom UI control value */
  content?: (string | number)[] | ViaMenuItem[];
  options?: (string | number)[] | number[];
}

export interface ViaCustomKeycode {
  name: string;
  title: string;
  shortName?: string;
}

export interface ViaDefinition {
  name: string;
  vendorId: string;
  productId: string;
  matrix: ViaMatrix;
  layouts: ViaLayouts;
  menus?: ViaMenuItem[];
  keycodes?: string[];
  customKeycodes?: ViaCustomKeycode[];
}

/** A parsed, absolutely-positioned key ready for rendering. */
export interface LayoutKey {
  /** index into the flattened key list, used as a stable id */
  index: number;
  row: number;
  col: number;
  /** -1 row/col means "decal"/no matrix position (rare) */
  x: number;
  y: number;
  w: number;
  h: number;
  labelRaw: string;
}

/** keymap[layer][row][col] = keycode string (e.g. "KC_A") */
export type Keymap = string[][][];
