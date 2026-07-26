// WebHID transport for the VIA/QMK raw-HID protocol (see viaProtocol.ts for
// the protocol itself). Mirrors the protocol used by the official VIA app
// (usage page 0xFF60, usage 0x61, 32-byte reports).

import { ViaProtocol, HidTransportError } from "./viaProtocol";

export { HidTransportError } from "./viaProtocol";

const VIA_USAGE_PAGE = 0xff60;
const VIA_USAGE = 0x61;
const REPORT_LENGTH = 32;

/** Manages one open WebHID device and request/response correlation for
 * the VIA raw-HID protocol (which has no built-in request IDs, so we
 * serialize requests one at a time). */
export class ViaDevice extends ViaProtocol {
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
    super();
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

  /** Queues this request behind any in-flight one so requests/responses
   * always pair up correctly, then sends it. */
  protected send(payload: number[]): Promise<DataView> {
    const run = this.queue.then(() => this.sendNow(payload));
    // swallow so a failed request doesn't poison the queue for later ones
    this.queue = run.catch(() => undefined);
    return run;
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
