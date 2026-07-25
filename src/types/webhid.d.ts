// Minimal ambient WebHID typings (not yet part of TypeScript's lib.dom.d.ts).
// Covers only what this app uses.

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDDeviceRequestOptions {
  filters: HIDDeviceFilter[];
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(
    type: "inputreport",
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => void,
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (this: HIDDevice, ev: HIDInputReportEvent) => void,
  ): void;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HID extends EventTarget {
  requestDevice(options: HIDDeviceRequestOptions): Promise<HIDDevice[]>;
  getDevices(): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid: HID;
}
