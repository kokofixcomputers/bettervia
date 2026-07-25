// QMK keycode values. Basic keycodes (0x00-0xE7) mirror QMK's keycodes.h,
// which mirrors USB HID usage IDs for the standard set. Quantum ranges
// (layer switching etc.) mirror current QMK quantum_keycodes.h constants.

export interface Keycode {
  code: number;
  /** short label shown on the pill keycap */
  label: string;
  /** longer descriptive title for tooltips / picker */
  title: string;
  /** QMK #define name */
  name: string;
}

export interface KeycodeGroup {
  id: string;
  label: string;
  keycodes: Keycode[];
}

const kc = (code: number, label: string, name: string, title?: string): Keycode => ({
  code,
  label,
  name,
  title: title ?? name,
});

const basic: Keycode[] = [
  kc(0x0000, "", "KC_NO", "Nothing"),
  kc(0x0001, "▽", "KC_TRNS", "Transparent"),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l, i) => kc(0x0004 + i, l, `KC_${l}`)),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((n, i) => kc(0x001e + i, n, `KC_${n}`)),
  kc(0x0028, "Enter", "KC_ENTER"),
  kc(0x0029, "Esc", "KC_ESCAPE"),
  kc(0x002a, "Bksp", "KC_BACKSPACE"),
  kc(0x002b, "Tab", "KC_TAB"),
  kc(0x002c, "Space", "KC_SPACE"),
  kc(0x002d, "-", "KC_MINUS"),
  kc(0x002e, "=", "KC_EQUAL"),
  kc(0x002f, "[", "KC_LEFT_BRACKET"),
  kc(0x0030, "]", "KC_RIGHT_BRACKET"),
  kc(0x0031, "\\", "KC_BACKSLASH"),
  kc(0x0032, "#", "KC_NONUS_HASH"),
  kc(0x0033, ";", "KC_SEMICOLON"),
  kc(0x0034, "'", "KC_QUOTE"),
  kc(0x0035, "`", "KC_GRAVE"),
  kc(0x0036, ",", "KC_COMMA"),
  kc(0x0037, ".", "KC_DOT"),
  kc(0x0038, "/", "KC_SLASH"),
  kc(0x0039, "Caps", "KC_CAPS_LOCK"),
  ...Array.from({ length: 12 }, (_, i) => kc(0x003a + i, `F${i + 1}`, `KC_F${i + 1}`)),
  kc(0x0046, "PrtSc", "KC_PRINT_SCREEN"),
  kc(0x0047, "ScrLk", "KC_SCROLL_LOCK"),
  kc(0x0048, "Pause", "KC_PAUSE"),
  kc(0x0049, "Ins", "KC_INSERT"),
  kc(0x004a, "Home", "KC_HOME"),
  kc(0x004b, "PgUp", "KC_PAGE_UP"),
  kc(0x004c, "Del", "KC_DELETE"),
  kc(0x004d, "End", "KC_END"),
  kc(0x004e, "PgDn", "KC_PAGE_DOWN"),
  kc(0x004f, "→", "KC_RIGHT"),
  kc(0x0050, "←", "KC_LEFT"),
  kc(0x0051, "↓", "KC_DOWN"),
  kc(0x0052, "↑", "KC_UP"),
  kc(0x0053, "Num", "KC_NUM_LOCK"),
  kc(0x0054, "KP/", "KC_KP_SLASH"),
  kc(0x0055, "KP*", "KC_KP_ASTERISK"),
  kc(0x0056, "KP-", "KC_KP_MINUS"),
  kc(0x0057, "KP+", "KC_KP_PLUS"),
  kc(0x0058, "KPEnt", "KC_KP_ENTER"),
  ...Array.from({ length: 9 }, (_, i) => kc(0x0059 + i, `KP${i + 1}`, `KC_KP_${i + 1}`)),
  kc(0x0062, "KP0", "KC_KP_0"),
  kc(0x0063, "KP.", "KC_KP_DOT"),
  kc(0x0064, "\\", "KC_NONUS_BACKSLASH"),
  kc(0x0065, "Menu", "KC_APPLICATION"),
  kc(0x0067, "KP=", "KC_KP_EQUAL"),
  ...Array.from({ length: 12 }, (_, i) => kc(0x0068 + i, `F${i + 13}`, `KC_F${i + 13}`)),
  kc(0x0074, "Exec", "KC_EXECUTE"),
  kc(0x0075, "Help", "KC_HELP"),
  kc(0x0077, "Select", "KC_SELECT"),
  kc(0x0078, "Stop", "KC_STOP"),
  kc(0x007f, "Mute", "KC_KB_MUTE"),
  kc(0x0080, "Vol+", "KC_KB_VOLUME_UP"),
  kc(0x0081, "Vol-", "KC_KB_VOLUME_DOWN"),
  kc(0x0085, "KP,", "KC_KP_COMMA"),
  kc(0x0090, "Intl1", "KC_INTERNATIONAL_1"),
  kc(0x0091, "Intl2", "KC_INTERNATIONAL_2"),
  kc(0x0092, "Intl3", "KC_INTERNATIONAL_3"),
  kc(0x0093, "Intl4", "KC_INTERNATIONAL_4"),
  kc(0x0094, "Intl5", "KC_INTERNATIONAL_5"),
];

const modifiers: Keycode[] = [
  kc(0x00e0, "LCtrl", "KC_LEFT_CTRL"),
  kc(0x00e1, "LShift", "KC_LEFT_SHIFT"),
  kc(0x00e2, "LAlt", "KC_LEFT_ALT"),
  kc(0x00e3, "LGUI", "KC_LEFT_GUI", "Left GUI / Win / Cmd"),
  kc(0x00e4, "RCtrl", "KC_RIGHT_CTRL"),
  kc(0x00e5, "RShift", "KC_RIGHT_SHIFT"),
  kc(0x00e6, "RAlt", "KC_RIGHT_ALT"),
  kc(0x00e7, "RGUI", "KC_RIGHT_GUI", "Right GUI / Win / Cmd"),
];

const media: Keycode[] = [
  kc(0x00a5, "Pwr", "KC_SYSTEM_POWER"),
  kc(0x00a6, "Sleep", "KC_SYSTEM_SLEEP"),
  kc(0x00a7, "Wake", "KC_SYSTEM_WAKE"),
  kc(0x00a8, "Mute", "KC_AUDIO_MUTE"),
  kc(0x00a9, "Vol+", "KC_AUDIO_VOL_UP"),
  kc(0x00aa, "Vol-", "KC_AUDIO_VOL_DOWN"),
  kc(0x00ab, "Next", "KC_MEDIA_NEXT_TRACK"),
  kc(0x00ac, "Prev", "KC_MEDIA_PREV_TRACK"),
  kc(0x00ad, "Stop", "KC_MEDIA_STOP"),
  kc(0x00ae, "Play", "KC_MEDIA_PLAY_PAUSE"),
  kc(0x00af, "Select", "KC_MEDIA_SELECT"),
  kc(0x00b0, "Eject", "KC_MEDIA_EJECT"),
  kc(0x00b2, "Mail", "KC_MAIL"),
  kc(0x00b3, "Calc", "KC_CALCULATOR"),
  kc(0x00b4, "MyPC", "KC_MY_COMPUTER"),
  kc(0x00b5, "Search", "KC_WWW_SEARCH"),
  kc(0x00b6, "WWWHome", "KC_WWW_HOME"),
  kc(0x00b7, "WWWBack", "KC_WWW_BACK"),
  kc(0x00b8, "WWWFwd", "KC_WWW_FORWARD"),
  kc(0x00b9, "WWWStop", "KC_WWW_STOP"),
  kc(0x00ba, "Refresh", "KC_WWW_REFRESH"),
  kc(0x00bb, "Favs", "KC_WWW_FAVORITES"),
  kc(0x00bc, "FFwd", "KC_MEDIA_FAST_FORWARD"),
  kc(0x00bd, "Rewind", "KC_MEDIA_REWIND"),
  kc(0x00be, "Bright+", "KC_BRIGHTNESS_UP"),
  kc(0x00bf, "Bright-", "KC_BRIGHTNESS_DOWN"),
];

const lighting: Keycode[] = [
  kc(0x7c00, "BL Tog", "QK_BACKLIGHT_TOGGLE"),
  kc(0x7c01, "BL+", "QK_BACKLIGHT_UP"),
  kc(0x7c02, "BL-", "QK_BACKLIGHT_DOWN"),
  kc(0x7c06, "RGB Tog", "QK_UNDERGLOW_TOGGLE"),
  kc(0x7c07, "RGB Mode+", "QK_UNDERGLOW_NEXT_EFFECT"),
  kc(0x7c08, "RGB Mode-", "QK_UNDERGLOW_PREVIOUS_EFFECT"),
  kc(0x7c09, "Hue+", "QK_UNDERGLOW_HUE_UP"),
  kc(0x7c0a, "Hue-", "QK_UNDERGLOW_HUE_DOWN"),
  kc(0x7c0b, "Sat+", "QK_UNDERGLOW_SATURATION_UP"),
  kc(0x7c0c, "Sat-", "QK_UNDERGLOW_SATURATION_DOWN"),
  kc(0x7c0d, "Bright+", "QK_UNDERGLOW_VALUE_UP"),
  kc(0x7c0e, "Bright-", "QK_UNDERGLOW_VALUE_DOWN"),
];

const misc: Keycode[] = [
  kc(0x005a, "Reset", "QK_BOOTLOADER", "Jump to bootloader"),
  kc(0x7c1a, "Reboot", "QK_REBOOT"),
  kc(0x7c1b, "Debug", "QK_DEBUG_TOGGLE"),
  kc(0x7c1c, "GESC", "QK_GRAVE_ESCAPE"),
];

export const LAYER_MAX = 15;

/** Layer / mod-tap key generators, matching current QMK quantum keycode ranges. */
export function MO(layer: number) {
  return 0x5100 + (layer & 0xf);
}
export function TO(layer: number) {
  return 0x5000 + (layer & 0xf);
}
export function TG(layer: number) {
  return 0x5060 + (layer & 0xf);
}
export function TT(layer: number) {
  return 0x50c0 + (layer & 0xf);
}
export function DF(layer: number) {
  return 0x5040 + (layer & 0xf);
}
export function OSL(layer: number) {
  return 0x5080 + (layer & 0xf);
}
export function LT(layer: number, basicKeycode: number) {
  return 0x4000 + ((layer & 0xf) << 8) + (basicKeycode & 0xff);
}

function layerGroup(
  id: string,
  label: string,
  title: string,
  fn: (layer: number) => number,
  layers: number,
): Keycode[] {
  return Array.from({ length: layers }, (_, layer) => ({
    code: fn(layer),
    label: `${label}(${layer})`,
    name: `${id}(${layer})`,
    title: `${title} ${layer}`,
  }));
}

export function buildLayerKeycodes(layerCount: number): KeycodeGroup {
  return {
    id: "layers",
    label: "Layers",
    keycodes: [
      ...layerGroup("MO", "MO", "Momentary layer", MO, layerCount),
      ...layerGroup("TG", "TG", "Toggle layer", TG, layerCount),
      ...layerGroup("TO", "TO", "Activate layer", TO, layerCount),
      ...layerGroup("TT", "TT", "Tap-toggle layer", TT, layerCount),
      ...layerGroup("DF", "DF", "Set default layer", DF, layerCount),
      ...layerGroup("OSL", "OSL", "One-shot layer", OSL, layerCount),
    ],
  };
}

/** Base value for a keyboard's custom (VIA) keycodes, e.g. USER00.. */
export const CUSTOM_KEYCODE_BASE = 0x7e00;

export function buildCustomKeycodeGroup(
  customKeycodes: { name: string; title: string }[] | undefined,
): KeycodeGroup | null {
  if (!customKeycodes || customKeycodes.length === 0) return null;
  return {
    id: "custom",
    label: "Custom",
    keycodes: customKeycodes.map((c, i) => ({
      code: CUSTOM_KEYCODE_BASE + i,
      label: c.name.replace(/\n/g, " "),
      name: `USER${String(i).padStart(2, "0")}`,
      title: c.title,
    })),
  };
}

export const KEYCODE_GROUPS: KeycodeGroup[] = [
  { id: "basic", label: "Basic", keycodes: basic },
  { id: "modifiers", label: "Modifiers", keycodes: modifiers },
  { id: "media", label: "Media", keycodes: media },
  { id: "lighting", label: "Lighting", keycodes: lighting },
  { id: "misc", label: "Misc", keycodes: misc },
];

export const ALL_STATIC_KEYCODES: Keycode[] = KEYCODE_GROUPS.flatMap((g) => g.keycodes);

export function findKeycode(code: number, extra: Keycode[] = []): Keycode | undefined {
  return (
    ALL_STATIC_KEYCODES.find((k) => k.code === code) ||
    extra.find((k) => k.code === code) ||
    undefined
  );
}

export function keycodeLabel(code: number, extra: Keycode[] = []): string {
  const found = findKeycode(code, extra);
  if (found) return found.label || found.name.replace(/^KC_/, "");
  // Fallback: decode known quantum ranges generically
  if (code >= 0x4000 && code < 0x5000) {
    const layer = (code >> 8) & 0xf;
    return `LT${layer}`;
  }
  if (code >= 0x5100 && code <= 0x510f) return `MO(${code - 0x5100})`;
  if (code >= 0x5000 && code <= 0x500f) return `TO(${code - 0x5000})`;
  if (code >= 0x5040 && code <= 0x504f) return `DF(${code - 0x5040})`;
  if (code >= 0x5060 && code <= 0x506f) return `TG(${code - 0x5060})`;
  if (code >= 0x5080 && code <= 0x508f) return `OSL(${code - 0x5080})`;
  if (code >= 0x50c0 && code <= 0x50cf) return `TT(${code - 0x50c0})`;
  return `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;
}
