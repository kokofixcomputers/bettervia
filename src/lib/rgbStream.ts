// Client for the custom "host RGB stream" raw-HID sub-protocol implemented
// by the `ryodeushii` keymap on NuPhy Air75 V2 / Halo75 V2 (see that
// keymap's RAW_HID_PROTOCOL.md). This rides alongside VIA on the same
// USB HID endpoint via a magic byte (0x77) VIA itself never sends, so it
// shares ViaDevice's request queue rather than opening a second connection.
//
// USB only — does not work over the 2.4GHz dongle or Bluetooth.

import type { ViaDevice } from "./hid";

const MAGIC = 0x77;

const Cmd = {
  Ping: 0x01,
  GetInfo: 0x02,
  GetBattery: 0x03,
  SetLed: 0x10,
  SetLedChunk: 0x11,
  FillAll: 0x12,
  ClearAll: 0x13,
  Commit: 0x14,
  SetHostMode: 0x15,
  SetBrightness: 0x16,
  NoOp: 0x17,
  SetSideLed: 0x20,
  SetSideLedChunk: 0x21,
  FillAllSide: 0x22,
  ClearAllSide: 0x23,
  SideCommit: 0x24,
  SetSideHostMode: 0x25,
} as const;

const Reply = {
  Ack: 0x80,
  Pong: 0x81,
  Info: 0x82,
  Battery: 0x83,
  Error: 0xff,
} as const;

export class RgbStreamError extends Error {}

export interface RgbStreamInfo {
  protocolVersion: number;
  mainLedCount: number;
  reportSize: number;
  currentEffect: number;
  mainHostEnabled: boolean;
  sideLedCount: number;
  sideHostEnabled: boolean;
}

export interface RgbStreamPong {
  protocolVersion: number;
  mainLedCount: number;
  capabilities: number;
  sideLedCount: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Max RGB triples per SET_LED_CHUNK packet: (32 - 5 header bytes) / 3. */
const MAIN_CHUNK_MAX = 9;
/** Max RGB triples per SET_SIDE_LED_CHUNK packet: (32 - 4 header bytes) / 3. */
const SIDE_CHUNK_MAX = 9;

export class RgbStreamClient {
  private device: ViaDevice;

  constructor(device: ViaDevice) {
    this.device = device;
  }

  private async send(subcommand: number, payload: number[] = []): Promise<DataView> {
    const res = await this.device.sendRaw([MAGIC, subcommand, ...payload]);
    const echoedMagic = res.getUint8(0);
    const replyCode = res.getUint8(1);
    if (echoedMagic !== MAGIC) {
      throw new RgbStreamError("Unexpected reply — this firmware doesn't speak the host RGB stream protocol");
    }
    if (replyCode === Reply.Error) {
      const code = res.getUint8(2);
      const meaning = code === 1 ? "unknown command" : code === 2 ? "bad index" : code === 3 ? "bad length" : `code ${code}`;
      throw new RgbStreamError(`Device rejected command: ${meaning}`);
    }
    return res;
  }

  /** Confirms the connected firmware implements this protocol. */
  async ping(): Promise<RgbStreamPong> {
    const res = await this.send(Cmd.Ping);
    return {
      protocolVersion: res.getUint8(2),
      mainLedCount: res.getUint8(3),
      capabilities: res.getUint8(4),
      sideLedCount: res.getUint8(5),
    };
  }

  async getInfo(): Promise<RgbStreamInfo> {
    const res = await this.send(Cmd.GetInfo);
    return {
      protocolVersion: res.getUint8(2),
      mainLedCount: res.getUint8(3),
      reportSize: res.getUint8(4),
      currentEffect: res.getUint8(5),
      mainHostEnabled: res.getUint8(6) !== 0,
      sideLedCount: res.getUint8(7),
      sideHostEnabled: res.getUint8(8) !== 0,
    };
  }

  async getBatteryPercent(): Promise<number> {
    const res = await this.send(Cmd.GetBattery);
    return res.getUint8(2);
  }

  // ---- Main matrix ----

  async setLed(index: number, color: RgbColor): Promise<void> {
    await this.send(Cmd.SetLed, [index & 0xff, (index >> 8) & 0xff, color.r, color.g, color.b]);
  }

  async setLedChunk(start: number, colors: RgbColor[]): Promise<void> {
    for (let i = 0; i < colors.length; i += MAIN_CHUNK_MAX) {
      const slice = colors.slice(i, i + MAIN_CHUNK_MAX);
      const chunkStart = start + i;
      const payload = [chunkStart & 0xff, (chunkStart >> 8) & 0xff, slice.length];
      for (const c of slice) payload.push(c.r, c.g, c.b);
      await this.send(Cmd.SetLedChunk, payload);
    }
  }

  async fillAll(color: RgbColor): Promise<void> {
    await this.send(Cmd.FillAll, [color.r, color.g, color.b]);
  }

  async clearAll(): Promise<void> {
    await this.send(Cmd.ClearAll);
  }

  async commit(): Promise<void> {
    await this.send(Cmd.Commit);
  }

  async setHostMode(enabled: boolean): Promise<void> {
    await this.send(Cmd.SetHostMode, [enabled ? 1 : 0]);
  }

  async setBrightness(value: number): Promise<void> {
    await this.send(Cmd.SetBrightness, [value & 0xff]);
  }

  // ---- Side / logo strip ----

  async setSideLed(index: number, color: RgbColor): Promise<void> {
    await this.send(Cmd.SetSideLed, [index & 0xff, color.r, color.g, color.b]);
  }

  async setSideLedChunk(start: number, colors: RgbColor[]): Promise<void> {
    for (let i = 0; i < colors.length; i += SIDE_CHUNK_MAX) {
      const slice = colors.slice(i, i + SIDE_CHUNK_MAX);
      const chunkStart = start + i;
      const payload = [chunkStart & 0xff, slice.length];
      for (const c of slice) payload.push(c.r, c.g, c.b);
      await this.send(Cmd.SetSideLedChunk, payload);
    }
  }

  async fillAllSide(color: RgbColor): Promise<void> {
    await this.send(Cmd.FillAllSide, [color.r, color.g, color.b]);
  }

  async clearAllSide(): Promise<void> {
    await this.send(Cmd.ClearAllSide);
  }

  async sideCommit(): Promise<void> {
    await this.send(Cmd.SideCommit);
  }

  async setSideHostMode(enabled: boolean): Promise<void> {
    await this.send(Cmd.SetSideHostMode, [enabled ? 1 : 0]);
  }

  /** Selects the host_stream RGB Matrix effect via standard VIA (not part
   * of this sub-protocol). QMK clamps out-of-range mode 255 down to the
   * last registered effect, which is host_stream. Runtime-only, matching
   * this feature's "nothing persists" design — deliberately not saved. */
  async selectHostStreamEffect(): Promise<void> {
    await this.device.customSetValue(3 /* id_qmk_rgb_matrix_channel */, 2 /* id_qmk_rgb_matrix_effect */, [255]);
  }
}
