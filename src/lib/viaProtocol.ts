// VIA/QMK raw-HID protocol (command IDs from quantum/via.h), independent of
// how bytes actually get to the device. Subclasses supply the transport
// (WebHID in the browser, native HID over Tauri IPC on desktop) by
// implementing `send()`; every higher-level VIA call is shared here so the
// protocol logic — and every previously-fixed bug in it (request ordering,
// timeouts, etc.) — isn't duplicated between the two.

export const ViaCommand = {
  GetProtocolVersion: 0x01,
  GetKeyboardValue: 0x02,
  SetKeyboardValue: 0x03,
  DynamicKeymapGetKeycode: 0x04,
  DynamicKeymapSetKeycode: 0x05,
  DynamicKeymapReset: 0x06,
  CustomSetValue: 0x07,
  CustomGetValue: 0x08,
  CustomSave: 0x09,
  EepromReset: 0x0a,
  BootloaderJump: 0x0b,
  DynamicKeymapMacroGetCount: 0x0c,
  DynamicKeymapMacroGetBufferSize: 0x0d,
  DynamicKeymapMacroGetBuffer: 0x0e,
  DynamicKeymapMacroSetBuffer: 0x0f,
  DynamicKeymapMacroReset: 0x10,
  DynamicKeymapGetLayerCount: 0x11,
  DynamicKeymapGetBuffer: 0x12,
  DynamicKeymapSetBuffer: 0x13,
  DynamicKeymapGetEncoder: 0x14,
  DynamicKeymapSetEncoder: 0x15,
} as const;

export const ViaKeyboardValue = {
  Uptime: 0x01,
  LayoutOptions: 0x02,
  SwitchMatrixState: 0x03,
  FirmwareVersion: 0x04,
  DeviceIndication: 0x05,
} as const;

export class HidTransportError extends Error {}

export abstract class ViaProtocol {
  abstract readonly productName: string | null | undefined;
  abstract readonly opened: boolean;
  abstract open(): Promise<void>;
  abstract close(): Promise<void>;

  /** Sends one 32-byte VIA report and resolves with the reply. Must
   * serialize internally so overlapping calls never interleave. */
  protected abstract send(payload: number[]): Promise<DataView>;

  /** Sends an arbitrary 32-byte report through the same transport/ordering
   * as every other VIA command — used by keyboard-specific sub-protocols
   * (e.g. a custom RGB streaming command set) that ride alongside VIA on
   * the same raw-HID endpoint and must stay strictly ordered with it. */
  sendRaw(payload: number[]): Promise<DataView> {
    return this.send(payload);
  }

  async getProtocolVersion(): Promise<number> {
    const res = await this.send([ViaCommand.GetProtocolVersion]);
    return (res.getUint8(1) << 8) | res.getUint8(2);
  }

  async getLayerCount(): Promise<number> {
    const res = await this.send([ViaCommand.DynamicKeymapGetLayerCount]);
    return res.getUint8(1);
  }

  async getLayoutOptions(): Promise<number> {
    const res = await this.send([ViaCommand.GetKeyboardValue, ViaKeyboardValue.LayoutOptions]);
    return (
      (res.getUint8(2) << 24) | (res.getUint8(3) << 16) | (res.getUint8(4) << 8) | res.getUint8(5)
    );
  }

  async getKeycode(layer: number, row: number, col: number): Promise<number> {
    const res = await this.send([ViaCommand.DynamicKeymapGetKeycode, layer, row, col]);
    return (res.getUint8(4) << 8) | res.getUint8(5);
  }

  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    await this.send([
      ViaCommand.DynamicKeymapSetKeycode,
      layer,
      row,
      col,
      (keycode >> 8) & 0xff,
      keycode & 0xff,
    ]);
  }

  /** Reads the entire dynamic keymap for a given layer via the buffer command,
   * which is far faster than one get_keycode call per key. */
  async getLayerBuffer(layer: number, rows: number, cols: number): Promise<Uint16Array> {
    const totalKeys = rows * cols;
    const totalBytes = totalKeys * 2;
    const out = new Uint16Array(totalKeys);
    const chunkBytes = 28; // 32 - 4 header bytes, kept even
    let offset = 0;
    let key = 0;
    while (offset < totalBytes) {
      const size = Math.min(chunkBytes, totalBytes - offset);
      const layerOffset = layer * rows * cols * 2 + offset;
      const res = await this.send([
        ViaCommand.DynamicKeymapGetBuffer,
        (layerOffset >> 8) & 0xff,
        layerOffset & 0xff,
        size,
      ]);
      for (let i = 0; i < size; i += 2) {
        out[key++] = (res.getUint8(4 + i) << 8) | res.getUint8(4 + i + 1);
      }
      offset += size;
    }
    return out;
  }

  /** Writes an entire layer's keymap via the buffer command — far fewer
   * round trips than one setKeycode call per key, used when applying a
   * whole saved profile at once. */
  async setLayerBuffer(layer: number, rows: number, cols: number, keycodes: Uint16Array): Promise<void> {
    const totalBytes = rows * cols * 2;
    const chunkBytes = 28; // 32 - 4 header bytes, kept even
    let offset = 0;
    let key = 0;
    while (offset < totalBytes) {
      const size = Math.min(chunkBytes, totalBytes - offset);
      const layerOffset = layer * rows * cols * 2 + offset;
      const payload = [ViaCommand.DynamicKeymapSetBuffer, (layerOffset >> 8) & 0xff, layerOffset & 0xff, size];
      for (let i = 0; i < size; i += 2) {
        const kc = keycodes[key++] ?? 0;
        payload.push((kc >> 8) & 0xff, kc & 0xff);
      }
      await this.send(payload);
      offset += size;
    }
  }

  /** Reads a "custom value" (lighting/QMK feature settings addressed by
   * channel + value id, as used by VIA's menus system). Returns up to
   * `length` raw bytes. */
  async customGetValue(channel: number, valueId: number, length = 1): Promise<number[]> {
    const res = await this.send([ViaCommand.CustomGetValue, channel, valueId]);
    const out: number[] = [];
    for (let i = 0; i < length; i++) out.push(res.getUint8(3 + i));
    return out;
  }

  async customSetValue(channel: number, valueId: number, bytes: number[]): Promise<void> {
    await this.send([ViaCommand.CustomSetValue, channel, valueId, ...bytes]);
  }

  async customSave(channel: number): Promise<void> {
    await this.send([ViaCommand.CustomSave, channel]);
  }

  async resetEeprom(): Promise<void> {
    await this.send([ViaCommand.EepromReset]);
  }

  async jumpToBootloader(): Promise<void> {
    await this.send([ViaCommand.BootloaderJump]);
  }
}
