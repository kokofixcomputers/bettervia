import { useCallback, useMemo, useRef, useState } from "react";
import type { ViaDefinition, LayoutKey } from "./types/via";
import { parseKleLayout } from "./lib/kle";
import { requestViaDevice, isWebHidSupported, HidTransportError } from "./lib/hid";
import type { ViaDevice } from "./lib/hid";
import { buildCustomKeycodeGroup, findKeycode } from "./data/keycodes";
import type { Keycode } from "./data/keycodes";
import Keyboard from "./components/Keyboard";
import KeycodePicker from "./components/KeycodePicker";
import MenuPanel from "./components/MenuPanel";
import RgbStreamPanel from "./components/RgbStreamPanel";
import nuphyExample from "./examples/nuphy_air75_v2.json";
import "./App.css";

const DEFAULT_LAYER_COUNT = 4;
const RGB_STREAM_VIEW = "__rgb_stream__";

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
  const [device, setDevice] = useState<ViaDevice | null>(null);
  const [status, setStatus] = useState<string>("No definition loaded");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string>("keymap");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customGroup = useMemo(
    () => buildCustomKeycodeGroup(definition?.customKeycodes),
    [definition],
  );
  const customKeycodes: Keycode[] = customGroup?.keycodes ?? [];

  const loadDefinition = useCallback((def: ViaDefinition) => {
    const parsedKeys = parseKleLayout(def.layouts);
    setDefinition(def);
    setKeys(parsedKeys);
    setKeymap(buildEmptyKeymap(DEFAULT_LAYER_COUNT, def.matrix.rows, def.matrix.cols));
    setLayerCount(DEFAULT_LAYER_COUNT);
    setCurrentLayer(0);
    setSelectedIndex(null);
    setView("keymap");
    setStatus(`Loaded "${def.name}" — ${def.matrix.rows}×${def.matrix.cols} matrix, ${parsedKeys.length} keys`);
  }, []);

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

  const loadExample = useCallback(() => {
    loadDefinition(parseDefinition(nuphyExample));
  }, [loadDefinition]);

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
      setDevice(dev);
      const version = await dev.getProtocolVersion();
      const layers = await dev.getLayerCount();
      setLayerCount(layers);
      setStatus(`Connected to ${dev.productName ?? "device"} — protocol v${version}, ${layers} layers`);

      if (definition) {
        const rows = definition.matrix.rows;
        const cols = definition.matrix.cols;
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
    } catch (err) {
      const msg = err instanceof HidTransportError ? err.message : (err as Error).message;
      setStatus(`Connection failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [definition]);

  const handleDisconnect = useCallback(async () => {
    if (device) {
      await device.close();
      setDevice(null);
      setStatus("Disconnected");
    }
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">⬡</span>
          <span>Keycap</span>
        </div>

        <div className="topbar__actions">
          <button className="pill-btn" type="button" onClick={() => fileInputRef.current?.click()}>
            Import JSON
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
          <button className="pill-btn" type="button" onClick={loadExample}>
            Load Example
          </button>
          {definition && (
            <button className="pill-btn" type="button" onClick={handleExport}>
              Export
            </button>
          )}
          {!device ? (
            <button className="pill-btn pill-btn--primary" type="button" disabled={busy} onClick={handleConnect}>
              Connect Device
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

      <div className="status-bar">{status}</div>

      {definition ? (
        <main className="workspace">
          <div className="layer-tabs">
            <button
              type="button"
              className={"pill-tab" + (view === "keymap" ? " pill-tab--active" : "")}
              onClick={() => setView("keymap")}
            >
              Keymap
            </button>
            {(definition.menus ?? []).map((m) => (
              <button
                key={m.label}
                type="button"
                className={"pill-tab" + (view === m.label ? " pill-tab--active" : "")}
                onClick={() => setView(m.label)}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              className={"pill-tab" + (view === RGB_STREAM_VIEW ? " pill-tab--active" : "")}
              onClick={() => setView(RGB_STREAM_VIEW)}
            >
              RGB Stream
            </button>
          </div>

          {view === "keymap" ? (
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
          ) : view === RGB_STREAM_VIEW ? (
            <RgbStreamPanel device={device} />
          ) : (
            <MenuPanel
              menu={definition.menus!.find((m) => m.label === view)!}
              device={device}
            />
          )}
        </main>
      ) : (
        <div className="empty-state">
          <p>Import a VIA-style keyboard definition JSON to get started.</p>
          <button className="pill-btn pill-btn--primary" type="button" onClick={loadExample}>
            Load NuPhy Air75 V2 Example
          </button>
        </div>
      )}
    </div>
  );
}
