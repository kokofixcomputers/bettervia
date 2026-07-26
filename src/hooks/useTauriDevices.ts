import { useEffect, useState } from "react";
import {
  isTauri,
  listHidDevices,
  onHidDeviceConnected,
  onHidDeviceDisconnected,
} from "../lib/tauriHid";
import type { HidDeviceInfo } from "../lib/tauriHid";

/** Tracks every currently-connected VIA-capable HID device while running as
 * a Tauri desktop app, kept live via the Rust backend's hotplug events. A
 * no-op (empty, static list) in the browser build. */
export function useTauriDevices(): HidDeviceInfo[] {
  const [devices, setDevices] = useState<HidDeviceInfo[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    listHidDevices().then((list) => {
      if (!cancelled) setDevices(list);
    });

    const unlistenPromises = [
      onHidDeviceConnected((info) => {
        setDevices((prev) => {
          if (prev.some((d) => d.path === info.path)) return prev;
          return [...prev, info];
        });
      }),
      onHidDeviceDisconnected((path) => {
        setDevices((prev) => prev.filter((d) => d.path !== path));
      }),
    ];

    return () => {
      cancelled = true;
      unlistenPromises.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);

  return devices;
}
