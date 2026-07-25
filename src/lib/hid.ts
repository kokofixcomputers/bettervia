// WebHID transport + VIA/QMK raw-HID protocol implementation.
// Mirrors the protocol used by the official VIA app (usage page 0xFF60,
// usage 0x61, 32-byte reports, command IDs from QMK's via.h).

const VIA_USAGE_PAGE = 0xff60;
const VIA_USAGE = 0x61;
const REPORT_LENGTH = 32;

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

/** Manages one open WebHID device and request/response correlation for
 * the VIA raw-HID protocol (which has no built-in request IDs, so we
 * serialize requests one at a time). */
export class ViaDevice {
  private device: HIDDevice;
  private pending: {
    resolve: (data: DataView) => void;
    reject: (err: Error) => void;
  } | null = null;
  /** Serializes calls to send() so overlapping requests queue instead of
   * being dropped — dropping writes silently is what causes a slider drag
   * to desync from the device (some writes never make it out). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(device: HIDDevice) {
    this.device = device;
    this.device.addEventListener("inputreport", this.onInputReport);
  }

  get productName() {
    return this.device.productName;
  }

  get opened() {
    return this.device.opened;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  async close() {
    this.device.removeEventListener("inputreport", this.onInputReport);
    if (this.device.opened) await this.device.close();
  }

  private onInputReport = (event: HIDInputReportEvent) => {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.resolve(event.data);
    }
  };

  /** Public entry point: queues this request behind any in-flight one so
   * requests/responses always pair up correctly, then sends it. */
  private send(payload: number[]): Promise<DataView> {
    const run = this.queue.then(() => this.sendNow(payload));
    // swallow so a failed request doesn't poison the queue for later ones
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Sends an arbitrary 32-byte report through the same request queue as
   * every other VIA command — needed for keyboard-specific sub-protocols
   * (e.g. a firmware's custom RGB streaming command set) that ride
   * alongside VIA on the same raw-HID endpoint and must stay strictly
   * ordered with it. */
  sendRaw(payload: number[]): Promise<DataView> {
    return this.send(payload);
  }

  private async sendNow(payload: number[]): Promise<DataView> {
    if (!this.device.opened) throw new HidTransportError("Device not open");

    const data = new Uint8Array(REPORT_LENGTH);
    data.set(payload.slice(0, REPORT_LENGTH));

    const responsePromise = new Promise<DataView>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new HidTransportError("VIA command timed out"));
        }
      }, 2000);
      this.pending = {
        resolve: (d: DataView) => {
          clearTimeout(timeout);
          resolve(d);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      };
    });

    await this.device.sendReport(0, data);
    return responsePromise;
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

export function isWebHidSupported(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export async function requestViaDevice(): Promise<ViaDevice | null> {
  if (!isWebHidSupported()) throw new HidTransportError("WebHID is not supported in this browser");
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE }],
  });
  if (devices.length === 0) return null;
  const device = new ViaDevice(devices[0]);
  await device.open();
  return device;
}

/** Attempts to reconnect to a previously-authorized device matching vendor/product IDs. */
export async function reconnectViaDevice(
  vendorId: number,
  productId: number,
): Promise<ViaDevice | null> {
  if (!isWebHidSupported()) return null;
  const devices = await navigator.hid.getDevices();
  const match = devices.find(
    (d) =>
      d.vendorId === vendorId &&
      d.productId === productId &&
      d.collections.some((c) => c.usagePage === VIA_USAGE_PAGE && c.usage === VIA_USAGE),
  );
  if (!match) return null;
  const device = new ViaDevice(match);
  await device.open();
  return device;
}
