import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconKeymap, IconBulb, IconWave, IconLayers, IconBook, IconPlug, IconDownload, IconUpload, IconBattery, AppIcon } from "./components/icons";
import { RgbStreamClient } from "./lib/rgbStream";
import type { ViaDefinition, LayoutKey } from "./types/via";
import { parseKleLayout } from "./lib/kle";
import { requestViaDevice, isWebHidSupported, HidTransportError } from "./lib/hid";
import type { ViaProtocol } from "./lib/viaProtocol";
import { isTauri, TauriViaDevice, listHidDevices, onHidDeviceConnected } from "./lib/tauriHid";
import type { HidDeviceInfo } from "./lib/tauriHid";
import { useTauriDevices } from "./hooks/useTauriDevices";
import {
  libraryKey,
  loadSettings,
  saveSettings,
  findInLibrary,
  upsertLibrary,
  removeFromLibrary,
} from "./lib/tauriSettings";
import type { SettingsFile, RgbStreamState, DeviceProfiles, Profile } from "./lib/tauriSettings";
import { buildCustomKeycodeGroup, findKeycode } from "./data/keycodes";
import type { Keycode } from "./data/keycodes";
import Keyboard from "./components/Keyboard";
import KeycodePicker from "./components/KeycodePicker";
import MenuPanel from "./components/MenuPanel";
import RgbStreamPanel from "./components/RgbStreamPanel";
import LibraryPage from "./components/LibraryPage";
import ProfilesPage from "./components/ProfilesPage";
import air75v2Example from "./examples/nuphy_air75_v2.json";
import halo75v2Example from "./examples/nuphy_halo75v2.json";
import "./App.css";

const DEFAULT_LAYER_COUNT = 4;
const RGB_STREAM_VIEW = "__rgb_stream__";
const LIBRARY_VIEW = "__library__";
const PROFILES_VIEW = "__profiles__";

const EXAMPLES: { label: string; definition: unknown }[] = [
  { label: "NuPhy Air75 V2", definition: air75v2Example },
  { label: "NuPhy Halo75 V2", definition: halo75v2Example },
];

type NumKeymap = number[][][]; // [layer][row][col]

function buildEmptyKeymap(layers: number, rows: number, cols: number): NumKeymap {
  return Array.from({ length: layers }, (_, layer) =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => (layer === 0 ? 0x0000 : 0x0001))),
  );
}

function parseDefinition(json: unknown): ViaDefinition {
  const def = json as ViaDefinition;
  if (!def || typeof def !== "object") throw new Error("Invalid JSON: not an object");
  if (!def.matrix || typeof def.matrix.rows !== "number" || typeof def.matrix.cols !== "number") {
    throw new Error("Invalid JSON: missing matrix.rows / matrix.cols");
  }
  if (!def.layouts || !Array.isArray(def.layouts.keymap)) {
    throw new Error("Invalid JSON: missing layouts.keymap");
  }
  return def;
}

export default function App() {
  const [definition, setDefinition] = useState<ViaDefinition | null>(null);
  const [keys, setKeys] = useState<LayoutKey[]>([]);
  const [keymap, setKeymap] = useState<NumKeymap>([]);
  const [layerCount, setLayerCount] = useState(DEFAULT_LAYER_COUNT);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [device, setDevice] = useState<ViaProtocol | null>(null);
  const [status, setStatus] = useState<string>("No definition loaded");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string>("keymap");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Tauri desktop shell: native HID, no per-connection permission
  // prompt, multi-device selector, per-device persisted settings. All of
  // this is inert in the plain browser build (isTauri() is false there). ----
  const runningInTauri = useMemo(() => isTauri(), []);
  const tauriDevices = useTauriDevices();
  const [activeDeviceKey, setActiveDeviceKey] = useState<string | null>(null);
  // Only for explicit "apply this now" requests (switching Profiles) —
  // RgbStreamPanel otherwise reads the live saved state itself via
  // getSavedRgbState(), never a value frozen at connect time.
  const [rgbApplyRequest, setRgbApplyRequest] = useState<{ token: number; state: RgbStreamState } | null>(null);
  const rgbApplyTokenRef = useRef(0);
  const getSavedRgbState = useCallback(
    () => (activeDeviceKey ? settingsRef.current.rgbStream[activeDeviceKey] : undefined),
    [activeDeviceKey],
  );
  const [library, setLibrary] = useState<ViaDefinition[]>([]);
  const [profilesByDevice, setProfilesByDevice] = useState<Record<string, DeviceProfiles>>({});
  const settingsRef = useRef<SettingsFile>({ library: [], rgbStream: {}, profiles: {} });
  const settingsLoaded = useRef(false);

  useEffect(() => {
    if (!runningInTauri) return;
    loadSettings().then((s) => {
      // First run: seed the library with the bundled boards so "plug in
      // your keyboard and it just works" is true out of the box, not only
      // after manually adding them.
      const seeded: SettingsFile =
        s.library.length === 0
          ? { ...s, library: EXAMPLES.map((ex) => parseDefinition(ex.definition)) }
          : s;
      settingsRef.current = seeded;
      settingsLoaded.current = true;
      setLibrary(seeded.library);
      setProfilesByDevice(seeded.profiles);
      if (seeded !== s) saveSettings(seeded).catch(() => undefined);
    });
  }, [runningInTauri]);

  const addToLibrary = useCallback(
    (def: ViaDefinition) => {
      if (!runningInTauri) return;
      setLibrary((prev) => {
        const next = upsertLibrary(prev, def);
        settingsRef.current = { ...settingsRef.current, library: next };
        saveSettings(settingsRef.current).catch(() => undefined);
        return next;
      });
    },
    [runningInTauri],
  );

  const removeFromLibraryHandler = useCallback((def: ViaDefinition) => {
    setLibrary((prev) => {
      const next = removeFromLibrary(prev, Number(def.vendorId), Number(def.productId));
      settingsRef.current = { ...settingsRef.current, library: next };
      saveSettings(settingsRef.current).catch(() => undefined);
      return next;
    });
  }, []);

  const onRgbStateChange = useCallback((key: string, state: RgbStreamState) => {
    settingsRef.current = {
      ...settingsRef.current,
      rgbStream: { ...settingsRef.current.rgbStream, [key]: state },
    };
    saveSettings(settingsRef.current).catch(() => undefined);
  }, []);

  const onSaveProfiles = useCallback((key: string, profiles: DeviceProfiles) => {
    setProfilesByDevice((prev) => {
      const next = { ...prev, [key]: profiles };
      settingsRef.current = { ...settingsRef.current, profiles: next };
      saveSettings(settingsRef.current).catch(() => undefined);
      return next;
    });
  }, []);

  /** Applies a saved profile to the live, connected device: writes its
   * keymap (if any) and hands its RGB config off to RgbStreamPanel via an
   * explicit, one-shot applyRequest (token-gated so it can never fire from
   * routine auto-saves — see RgbStreamPanel's effect on `applyRequest`). */
  const onApplyProfile = useCallback(
    async (profile: Profile) => {
      if (!device || !definition) return;
      if (profile.keymap) {
        const rows = definition.matrix.rows;
        const cols = definition.matrix.cols;
        try {
          for (let layer = 0; layer < profile.keymap.length; layer++) {
            const flat = new Uint16Array(rows * cols);
            let idx = 0;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) flat[idx++] = profile.keymap[layer]?.[r]?.[c] ?? 0;
            }
            await device.setLayerBuffer(layer, rows, cols, flat);
          }
          setKeymap(profile.keymap.map((l) => l.map((r) => [...r])));
        } catch (err) {
          setStatus(`Failed to apply profile keymap: ${(err as Error).message}`);
        }
      }

      let rgbState: RgbStreamState | undefined = profile.rgbStream;
      if (!rgbState && profile.builtInEffect !== undefined) {
        try {
          await device.customSetValue(3, 2, [profile.builtInEffect]);
          await device.customSave(3);
        } catch {
          // best effort
        }
        rgbState = {
          streaming: false,
          playing: false,
          frames: [],
          currentFrame: 0,
          frameMs: 200,
          brightness: 255,
          sideBrightness: 255,
        };
      }
      if (rgbState) {
        rgbApplyTokenRef.current += 1;
        setRgbApplyRequest({ token: rgbApplyTokenRef.current, state: rgbState });
      }
    },
    [device, definition],
  );

  const customGroup = useMemo(
    () => buildCustomKeycodeGroup(definition?.customKeycodes),
    [definition],
  );
  const customKeycodes: Keycode[] = customGroup?.keycodes ?? [];

  const loadDefinition = useCallback(
    (def: ViaDefinition) => {
      const parsedKeys = parseKleLayout(def.layouts);
      setDefinition(def);
      setKeys(parsedKeys);
      setKeymap(buildEmptyKeymap(DEFAULT_LAYER_COUNT, def.matrix.rows, def.matrix.cols));
      setLayerCount(DEFAULT_LAYER_COUNT);
      setCurrentLayer(0);
      setSelectedIndex(null);
      setView("keymap");
      setStatus(`Loaded "${def.name}" — ${def.matrix.rows}×${def.matrix.cols} matrix, ${parsedKeys.length} keys`);
      // Any definition that gets loaded — imported, an example, or opened
      // from the library itself — is worth remembering, so the next time
      // this exact board is plugged in it's matched automatically.
      addToLibrary(def);
    },
    [addToLibrary],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const def = parseDefinition(JSON.parse(text));
        loadDefinition(def);
      } catch (err) {
        setStatus(`Import failed: ${(err as Error).message}`);
      }
    },
    [loadDefinition],
  );

  const loadExample = useCallback(
    (definition: unknown) => {
      loadDefinition(parseDefinition(definition));
    },
    [loadDefinition],
  );

  /** Shared by both transports: read protocol version/layer count, then the
   * live keymap if a definition is already known (for the Tauri path this
   * runs after a stored definition for the device has been auto-loaded). */
  const finishConnect = useCallback(async (dev: ViaProtocol, activeDefinition: ViaDefinition | null) => {
    setDevice(dev);
    const version = await dev.getProtocolVersion();
    const layers = await dev.getLayerCount();
    setLayerCount(layers);
    setStatus(`Connected to ${dev.productName ?? "device"} — protocol v${version}, ${layers} layers`);

    if (activeDefinition) {
      const rows = activeDefinition.matrix.rows;
      const cols = activeDefinition.matrix.cols;
      const newKeymap = buildEmptyKeymap(layers, rows, cols);
      for (let layer = 0; layer < layers; layer++) {
        try {
          const buf = await dev.getLayerBuffer(layer, rows, cols);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              newKeymap[layer][r][c] = buf[r * cols + c];
            }
          }
        } catch {
          // buffer read unsupported/failed; leave defaults for this layer
        }
      }
      setKeymap(newKeymap);
      setCurrentLayer(0);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    if (!isWebHidSupported()) {
      setStatus("WebHID is not supported in this browser (try Chrome or Edge)");
      return;
    }
    setBusy(true);
    try {
      const dev = await requestViaDevice();
      if (!dev) {
        setStatus("No device selected");
        setBusy(false);
        return;
      }
      await finishConnect(dev, definition);
    } catch (err) {
      const msg = err instanceof HidTransportError ? err.message : (err as Error).message;
      setStatus(`Connection failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [definition, finishConnect]);

  /** Tauri path: open a native HID device directly (no permission prompt),
   * and match it against the library by vendor/product ID — whichever
   * keyboard this is, if it's in the library it works immediately, no
   * per-device setup step required first. */
  const connectTauriDevice = useCallback(
    async (info: HidDeviceInfo) => {
      setBusy(true);
      try {
        const dev = new TauriViaDevice(info);
        await dev.open();
        const key = libraryKey(info.vendorId, info.productId);
        setActiveDeviceKey(key);

        let activeDefinition = definition;
        const match = findInLibrary(settingsRef.current.library, info.vendorId, info.productId);
        if (match) {
          activeDefinition = match;
          loadDefinition(match);
        }

        await finishConnect(dev, activeDefinition);
      } catch (err) {
        const msg = err instanceof HidTransportError ? err.message : (err as Error).message;
        setStatus(`Connection failed: ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [definition, finishConnect, loadDefinition],
  );

  // Keep a stable ref to the latest connect callback so the mount-only
  // hotplug subscription below never needs to resubscribe.
  const connectTauriDeviceRef = useRef(connectTauriDevice);
  useEffect(() => {
    connectTauriDeviceRef.current = connectTauriDevice;
  }, [connectTauriDevice]);

  // Auto-connect: a keyboard plugged in while the app is running starts
  // controlling it immediately (no button click). Devices already present
  // at launch only auto-connect if there's exactly one — with several
  // already plugged in, there's no way to guess which one the user wants,
  // so that case is left to the selector.
  useEffect(() => {
    if (!runningInTauri) return;
    let cancelled = false;

    listHidDevices().then((list) => {
      if (!cancelled && list.length === 1) connectTauriDeviceRef.current(list[0]);
    });

    const unlistenPromise = onHidDeviceConnected((info) => {
      connectTauriDeviceRef.current(info);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [runningInTauri]);

  // If the active device disappears from the connected-device list (unplugged),
  // clear it from the UI — Rust's own state cleanup already dropped the handle.
  useEffect(() => {
    if (!runningInTauri || !activeDeviceKey) return;
    const stillConnected = tauriDevices.some((d) => libraryKey(d.vendorId, d.productId) === activeDeviceKey);
    if (!stillConnected) {
      setDevice(null);
      setActiveDeviceKey(null);
      setStatus("Device disconnected");
    }
  }, [tauriDevices, activeDeviceKey, runningInTauri]);


  const handleDisconnect = useCallback(async () => {
    if (device) {
      await device.close();
      setDevice(null);
      setActiveDeviceKey(null);
      setStatus("Disconnected");
    }
  }, [device]);

  // Battery level for the topbar icon. VIA itself has no standard battery
  // command — this only works on boards whose firmware answers the custom
  // RGB-stream protocol's battery query (see lib/rgbStream.ts), so probe
  // silently and just show nothing if it's unsupported rather than erroring.
  const [batteryPercent, setBatteryPercent] = useState<number | null>(null);
  useEffect(() => {
    setBatteryPercent(null);
    if (!device) return;
    let cancelled = false;
    const client = new RgbStreamClient(device);

    const poll = async () => {
      try {
        const pct = await client.getBatteryPercent();
        if (!cancelled) setBatteryPercent(pct);
      } catch {
        if (!cancelled) setBatteryPercent(null);
      }
    };

    poll();
    const interval = setInterval(poll, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [device]);

  const keycodeAt = useCallback(
    (row: number, col: number) => keymap[currentLayer]?.[row]?.[col] ?? 0,
    [keymap, currentLayer],
  );

  const selectedKey = selectedIndex !== null ? keys.find((k) => k.index === selectedIndex) : undefined;

  const handlePickKeycode = useCallback(
    async (kc: Keycode) => {
      if (!selectedKey || selectedKey.row < 0 || selectedKey.col < 0) return;
      const { row, col } = selectedKey;

      setKeymap((prev) => {
        const next = prev.map((layer) => layer.map((r) => [...r]));
        next[currentLayer][row][col] = kc.code;
        return next;
      });

      if (device) {
        try {
          await device.setKeycode(currentLayer, row, col, kc.code);
        } catch (err) {
          setStatus(`Failed to write key: ${(err as Error).message}`);
        }
      }
    },
    [selectedKey, currentLayer, device],
  );

  const handleExport = useCallback(() => {
    if (!definition) return;
    const payload = {
      name: definition.name,
      vendorId: definition.vendorId,
      productId: definition.productId,
      matrix: definition.matrix,
      layers: keymap,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${definition.name.replace(/\s+/g, "_")}_keymap.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [definition, keymap]);

  const handleResetEeprom = useCallback(async () => {
    if (!device) return;
    if (!confirm("Reset the keyboard's EEPROM to firmware defaults? This clears your keymap on the device.")) return;
    setBusy(true);
    try {
      await device.resetEeprom();
      setStatus("EEPROM reset — reconnect to reload the keymap");
    } catch (err) {
      setStatus(`Reset failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [device]);

  const selectedLabel = useMemo(() => {
    if (!selectedKey) return null;
    if (selectedKey.row < 0 || selectedKey.col < 0) return null;
    const code = keycodeAt(selectedKey.row, selectedKey.col);
    return findKeycode(code, customKeycodes);
  }, [selectedKey, keycodeAt, customKeycodes]);

  const menuIconPalette = ["orange", "pink", "blue"] as const;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <AppIcon size={28} className="sidebar__logo" />
          <span>Keycap</span>
        </div>

        <nav className="sidebar__nav">
          <span className="sidebar__section">Keyboard</span>
          <SidebarItem
            active={view === "keymap"}
            disabled={!definition}
            onClick={() => setView("keymap")}
            icon={<IconKeymap />}
            color="purple"
            title="Keymap"
            sub="Remap your keys"
          />
          {(definition?.menus ?? []).map((m, i) => (
            <SidebarItem
              key={m.label}
              active={view === m.label}
              onClick={() => setView(m.label)}
              icon={<IconBulb />}
              color={menuIconPalette[i % menuIconPalette.length]}
              title={m.label}
              sub="Device settings"
            />
          ))}
          <SidebarItem
            active={view === RGB_STREAM_VIEW}
            disabled={!device}
            onClick={() => setView(RGB_STREAM_VIEW)}
            icon={<IconWave />}
            color="pink"
            title="RGB Stream"
            sub="Custom animations"
          />

          <span className="sidebar__section">Manage</span>
          <SidebarItem
            active={view === PROFILES_VIEW}
            disabled={!runningInTauri}
            onClick={() => setView(PROFILES_VIEW)}
            icon={<IconLayers />}
            color="green"
            title="Profiles"
            sub="Saved setups"
          />
          <SidebarItem
            active={view === LIBRARY_VIEW}
            disabled={!runningInTauri}
            onClick={() => setView(LIBRARY_VIEW)}
            icon={<IconBook />}
            color="blue"
            title="Library"
            sub={library.length > 0 ? `${library.length} boards` : "Add keyboards"}
          />
        </nav>

        <div className="sidebar__footer">{status}</div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar__actions">
            <button className="pill-btn" type="button" onClick={() => fileInputRef.current?.click()}>
              <IconUpload /> Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            <select
              className="pill-input pill-input--select"
              value=""
              onChange={(e) => {
                const ex = EXAMPLES.find((x) => x.label === e.target.value);
                if (ex) loadExample(ex.definition);
              }}
            >
              <option value="" disabled>
                Load Example…
              </option>
              {EXAMPLES.map((ex) => (
                <option key={ex.label} value={ex.label}>
                  {ex.label}
                </option>
              ))}
            </select>
            {definition && (
              <button className="pill-btn" type="button" onClick={handleExport}>
                <IconDownload /> Export
              </button>
            )}

            {device && batteryPercent !== null && (
              <span className="battery-badge" title={`Battery: ${batteryPercent}%`}>
                <IconBattery percent={batteryPercent} />
                {batteryPercent}%
              </span>
            )}

            {runningInTauri ? (
              <>
                <select
                  className="pill-input pill-input--select"
                  value={device instanceof TauriViaDevice ? device.path : ""}
                  disabled={busy}
                  onChange={(e) => {
                    const info = tauriDevices.find((d) => d.path === e.target.value);
                    if (info) connectTauriDevice(info);
                  }}
                >
                  <option value="" disabled>
                    {tauriDevices.length === 0 ? "No keyboard detected" : "Select keyboard…"}
                  </option>
                  {tauriDevices.map((d) => (
                    <option key={d.path} value={d.path}>
                      {d.productString ?? `${d.vendorId.toString(16)}:${d.productId.toString(16)}`}
                    </option>
                  ))}
                </select>
                {device && (
                  <button className="pill-btn pill-btn--danger" type="button" onClick={handleResetEeprom}>
                    Reset EEPROM
                  </button>
                )}
              </>
            ) : !device ? (
              <button className="pill-btn pill-btn--primary" type="button" disabled={busy} onClick={handleConnect}>
                <IconPlug /> Connect Device
              </button>
            ) : (
              <>
                <button className="pill-btn pill-btn--danger" type="button" onClick={handleResetEeprom}>
                  Reset EEPROM
                </button>
                <button className="pill-btn" type="button" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        </header>

        {view === LIBRARY_VIEW ? (
          <main className="workspace">
            <LibraryPage
              library={library}
              examples={EXAMPLES}
              onImport={addToLibrary}
              onRemove={removeFromLibraryHandler}
              onOpen={loadDefinition}
              parseDefinition={parseDefinition}
            />
          </main>
        ) : view === PROFILES_VIEW ? (
          <main className="workspace">
            <ProfilesPage
              deviceKey={activeDeviceKey}
              definition={definition}
              keymap={keymap}
              currentRgbState={activeDeviceKey ? settingsRef.current.rgbStream[activeDeviceKey] : undefined}
              deviceProfiles={activeDeviceKey ? profilesByDevice[activeDeviceKey] : undefined}
              onSaveProfiles={onSaveProfiles}
              onApplyProfile={onApplyProfile}
            />
          </main>
        ) : definition ? (
          <main className="workspace">
            {view === "keymap" && (
              <>
                <div className="layer-tabs">
                  {Array.from({ length: layerCount }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={"pill-tab" + (i === currentLayer ? " pill-tab--active" : "")}
                      onClick={() => setCurrentLayer(i)}
                    >
                      Layer {i}
                    </button>
                  ))}
                </div>

                <div className="keyboard-wrap">
                  <Keyboard
                    keys={keys}
                    keycodeAt={keycodeAt}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    customKeycodes={customKeycodes}
                  />
                </div>

                <div className="selection-info">
                  {selectedKey ? (
                    <>
                      <span className="selection-info__pos">
                        {selectedKey.row >= 0 ? `Row ${selectedKey.row}, Col ${selectedKey.col}` : "Unmapped key"}
                      </span>
                      {selectedLabel && <span className="selection-info__name">{selectedLabel.title}</span>}
                    </>
                  ) : (
                    <span>Select a key to assign a keycode</span>
                  )}
                </div>

                <KeycodePicker
                  layerCount={layerCount}
                  customGroup={customGroup}
                  onPick={handlePickKeycode}
                  disabled={selectedIndex === null}
                />
              </>
            )}

            {view !== "keymap" &&
              view !== RGB_STREAM_VIEW &&
              (() => {
                const activeMenu = definition.menus!.find((m) => m.label === view)!;
                return <MenuPanel menu={activeMenu} device={device} />;
              })()}
          </main>
        ) : (
          <div className="empty-state">
            <p>Import a VIA-style keyboard definition JSON to get started.</p>
            <div className="empty-state__examples">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  className="pill-btn pill-btn--primary"
                  type="button"
                  onClick={() => loadExample(ex.definition)}
                >
                  Load {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Always mounted (not conditionally rendered like the views above)
            so a running animation loop keeps streaming to the device even
            while looking at another page — only visually hidden here,
            never unmounted. */}
        <div
          className="workspace"
          style={{ display: view === RGB_STREAM_VIEW ? "flex" : "none" }}
        >
          <RgbStreamPanel
            device={device}
            deviceKey={activeDeviceKey}
            getSavedState={getSavedRgbState}
            onStateChange={onRgbStateChange}
            applyRequest={rgbApplyRequest}
          />
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  active,
  disabled,
  onClick,
  icon,
  color,
  title,
  sub,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  color: "purple" | "orange" | "pink" | "green" | "blue";
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      className={
        "sidebar__item" +
        (active ? " sidebar__item--active" : "") +
        (disabled ? " sidebar__item--disabled" : "")
      }
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <span className={`sidebar__icon sidebar__icon--${color}`}>{icon}</span>
      <span className="sidebar__item-text">
        <span className="sidebar__item-title">{title}</span>
        <span className="sidebar__item-sub">{sub}</span>
      </span>
    </button>
  );
}
