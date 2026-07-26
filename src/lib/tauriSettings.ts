// Persisted app settings, stored to disk by the Tauri backend (one JSON
// file in the OS app-data directory — see src-tauri/src/settings.rs). The
// frontend owns the shape; Rust just stores/loads whatever blob it's given.
//
// The main thing kept here is the "library": every VIA definition JSON the
// user has ever imported or added, keyed by vendorId:productId. It's the
// thing every newly-connected device gets matched against — whichever
// keyboard gets plugged in, if its vendor/product ID is in the library, it
// works immediately, with no per-device setup step required first.
//
// Also kept here, both keyed the same way (vendorId:productId):
// - `rgbStream`: the live/current RGB Stream state (frames, whether it was
//   playing, speed, brightness) — auto-saved continuously so relaunching
//   the app resumes exactly where you left off instead of starting from
//   scratch and needing "Detect Support" clicked again every time.
// - `profiles`: named, deliberate snapshots of a full setup (keymap +
//   RGB Stream config) that can be saved and switched between on demand —
//   distinct from the single auto-saved "current" rgbStream state above.

import { invoke } from "@tauri-apps/api/core";
import type { ViaDefinition } from "../types/via";
import type { RgbColor } from "./rgbStream";

export interface RgbFrame {
  main: RgbColor[];
  side: RgbColor[];
}

export interface RgbStreamState {
  streaming: boolean;
  playing: boolean;
  frames: RgbFrame[];
  currentFrame: number;
  frameMs: number;
  brightness: number;
  sideBrightness: number;
}

export interface Profile {
  id: string;
  name: string;
  /** Full keymap snapshot: [layer][row][col] -> raw keycode. Omitted means
   * "don't touch the keymap" when applying this profile. */
  keymap?: number[][][];
  /** Omitted means "leave RGB Stream/lighting alone" when applying. */
  rgbStream?: RgbStreamState;
  /** When rgbStream is absent or streaming=false, optionally select this
   * built-in QMK RGB Matrix effect index instead (see the Lighting menu's
   * "Effect" dropdown for what the indices mean on a given board). */
  builtInEffect?: number;
}

export interface DeviceProfiles {
  list: Profile[];
  activeId?: string;
}

export interface SettingsFile {
  library: ViaDefinition[];
  rgbStream: Record<string, RgbStreamState>;
  profiles: Record<string, DeviceProfiles>;
}

const EMPTY: SettingsFile = { library: [], rgbStream: {}, profiles: {} };

function parseHexId(id: string): number {
  return Number(id);
}

export function libraryKey(vendorId: number, productId: number): string {
  return `${vendorId}:${productId}`;
}

export function definitionKey(def: ViaDefinition): string {
  return libraryKey(parseHexId(def.vendorId), parseHexId(def.productId));
}

export function findInLibrary(
  library: ViaDefinition[],
  vendorId: number,
  productId: number,
): ViaDefinition | undefined {
  const key = libraryKey(vendorId, productId);
  return library.find((d) => definitionKey(d) === key);
}

/** Adds or replaces (by vendorId:productId) a library entry. */
export function upsertLibrary(library: ViaDefinition[], def: ViaDefinition): ViaDefinition[] {
  const key = definitionKey(def);
  const next = library.filter((d) => definitionKey(d) !== key);
  next.push(def);
  return next;
}

export function removeFromLibrary(
  library: ViaDefinition[],
  vendorId: number,
  productId: number,
): ViaDefinition[] {
  const key = libraryKey(vendorId, productId);
  return library.filter((d) => definitionKey(d) !== key);
}

function normalize(raw: unknown): SettingsFile {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const r = raw as Partial<SettingsFile>;
  return {
    library: Array.isArray(r.library) ? r.library : [],
    rgbStream: r.rgbStream && typeof r.rgbStream === "object" ? r.rgbStream : {},
    profiles: r.profiles && typeof r.profiles === "object" ? r.profiles : {},
  };
}

export async function loadSettings(): Promise<SettingsFile> {
  try {
    return normalize(await invoke<unknown>("load_settings"));
  } catch {
    return { ...EMPTY };
  }
}

export async function saveSettings(settings: SettingsFile): Promise<void> {
  await invoke("save_settings", { data: settings });
}
