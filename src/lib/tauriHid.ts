// Native HID transport for the VIA/QMK raw-HID protocol, backed by the
// Tauri desktop shell's Rust `hidapi` layer instead of WebHID. The payoff
// over the browser build: opening a device here doesn't need a per-origin
// permission prompt (that's a WebHID/browser security requirement, not
// something the protocol itself needs), so a previously-seen keyboard can
// be reopened automatically the instant it's plugged in.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ViaProtocol, HidTransportError } from "./viaProtocol";

export interface HidDeviceInfo {
  path: string;
  vendorId: number;
  productId: number;
  productString: string | null;
  serialNumber: string | null;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function listHidDevices(): Promise<HidDeviceInfo[]> {
  return invoke<HidDeviceInfo[]>("list_hid_devices");
}

export function onHidDeviceConnected(cb: (info: HidDeviceInfo) => void): Promise<UnlistenFn> {
  return listen<HidDeviceInfo>("hid-device-connected", (e) => cb(e.payload));
}

export function onHidDeviceDisconnected(cb: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>("hid-device-disconnected", (e) => cb(e.payload));
}

/** Native OS-thread heartbeat used to pace things like animation playback —
 * see src-tauri/src/ticker.rs for why this exists instead of a JS timer. */
export function startTicker(intervalMs: number): void {
  invoke("start_ticker", { intervalMs }).catch(() => undefined);
}

export function stopTicker(): void {
  invoke("stop_ticker").catch(() => undefined);
}

export function listenRgbTick(cb: () => void): Promise<UnlistenFn> {
  return listen("rgb-tick", () => cb());
}

/** One VIA device reached over Tauri's native HID bridge. Rust's own Mutex
 * around the open device handle already serializes concurrent transfers
 * correctly (see src-tauri/src/hid.rs), so unlike the WebHID transport this
 * doesn't need its own JS-side request queue. */
export class TauriViaDevice extends ViaProtocol {
  readonly path: string;
  readonly info: HidDeviceInfo;
  private isOpen = false;

  constructor(info: HidDeviceInfo) {
    super();
    this.info = info;
    this.path = info.path;
  }

  get productName() {
    return this.info.productString;
  }

  get opened() {
    return this.isOpen;
  }

  async open(): Promise<void> {
    await invoke("open_hid_device", { path: this.path });
    this.isOpen = true;
  }

  async close(): Promise<void> {
    await invoke("close_hid_device", { path: this.path });
    this.isOpen = false;
  }

  protected async send(payload: number[]): Promise<DataView> {
    if (!this.isOpen) throw new HidTransportError("Device not open");
    try {
      const bytes = await invoke<number[]>("hid_transfer", {
        path: this.path,
        report: payload,
      });
      return new DataView(new Uint8Array(bytes).buffer);
    } catch (err) {
      throw new HidTransportError(typeof err === "string" ? err : String(err));
    }
  }
}
