import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViaMenuItem } from "../types/via";
import { buildMenuTree, evaluateShowIf, flattenControls } from "../lib/menu";
import type { MenuControl, MenuGroup } from "../lib/menu";
import type { ViaProtocol } from "../lib/viaProtocol";

interface MenuPanelProps {
  menu: ViaMenuItem;
  device: ViaProtocol | null;
}

// Ports QMK's exact hsv_to_rgb_impl (quantum/color.c) byte-for-byte, rather
// than a generic floating-point HSV formula — this is the literal algorithm
// the firmware itself uses to turn a stored hue/sat/value byte triple into
// what actually lights up, so the swatch shown here matches the device
// exactly instead of drifting at region boundaries.
function qmkHsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0) return [v, v, v];
  const region = Math.floor((h * 6) / 255);
  const remainder = (h * 2 - region * 85) * 3;
  const p = (v * (255 - s)) >> 8;
  const q = (v * (255 - ((s * remainder) >> 8))) >> 8;
  const t = (v * (255 - ((s * (255 - remainder)) >> 8))) >> 8;
  switch (region % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, q, p];
  }
}

function hsvToHex(hue: number, sat: number, value = 255): string {
  const [r, g, b] = qmkHsvToRgb(hue, sat, value);
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Standard RGB->HSV (the scientific inverse of any HSV->RGB, including
 * QMK's) — unlike the device, this keeps `v` so callers can decide what to
 * do with lightness, which the 2-byte hue+sat wire format can't carry. */
function hexToHsv(hex: string): [hue: number, sat: number, value: number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [Math.round((h / 360) * 255), Math.round(s * 255), Math.round(max * 255)];
}

export default function MenuPanel({ menu, device }: MenuPanelProps) {
  const tree = useMemo(() => buildMenuTree((menu.content as ViaMenuItem[]) ?? []), [menu]);
  const controls = useMemo(() => flattenControls(tree), [tree]);

  const [values, setValues] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<Record<string, boolean>>({});
  // What the device last reported back for a given control, kept separate
  // from `values` (the live editable/displayed value) so a stale or
  // unreliable GET response can never snap the picker back — it's shown
  // only as a diagnostic "device says: [...]" readout.
  const [confirmed, setConfirmed] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (!device) {
      setValues({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const next: Record<string, number[]> = {};
      for (const c of controls) {
        try {
          const len = c.type === "color" ? 2 : 1;
          const bytes = await device.customGetValue(c.channel, c.valueId, len);
          next[c.id] = bytes;
        } catch {
          next[c.id] = [0];
        }
        if (cancelled) return;
      }
      if (!cancelled) {
        setValues(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [device, controls]);

  const scalarValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, bytes] of Object.entries(values)) out[id] = bytes[0] ?? 0;
    return out;
  }, [values]);

  // Debounce device writes per control: a slider drag fires many onChange
  // events, but only the final value needs to reach the device. Writing on
  // every tick queued up dozens of redundant set+save round trips, and
  // whichever one happened to land last "won" — which read as random
  // controls appearing to affect the wrong thing.
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleChange = useCallback(
    (control: MenuControl, bytes: number[]) => {
      setValues((prev) => ({ ...prev, [control.id]: bytes }));
      if (!device) return;

      const existing = debounceTimers.current[control.id];
      if (existing) clearTimeout(existing);
      debounceTimers.current[control.id] = setTimeout(() => {
        delete debounceTimers.current[control.id];
        setUnconfirmed((prev) => ({ ...prev, [control.id]: true }));
        device
          .customSetValue(control.channel, control.valueId, bytes)
          .then(() => device.customSave(control.channel))
          // Read back what the device reports post-save, purely as a
          // diagnostic — never used to drive the displayed/editable value.
          .then(() => device.customGetValue(control.channel, control.valueId, bytes.length))
          .then(
            (readBack) => {
              setConfirmed((prev) => ({ ...prev, [control.id]: readBack }));
              setUnconfirmed((prev) => ({ ...prev, [control.id]: false }));
            },
            () => {
              setUnconfirmed((prev) => ({ ...prev, [control.id]: false }));
            },
          );
      }, 120);
    },
    [device],
  );

  if (!device) {
    return <div className="menu-panel menu-panel--disconnected">Connect a device to edit these settings.</div>;
  }

  return (
    <div className="menu-panel">
      {loading && <div className="menu-panel__loading">Reading current settings…</div>}
      {tree.map((node, i) => (
        <MenuNode
          key={i}
          node={node}
          values={scalarValues}
          rawValues={values}
          confirmed={confirmed}
          unconfirmed={unconfirmed}
          onChange={handleChange}
        />
      ))}
    </div>
  );
}

function MenuNode({
  node,
  values,
  rawValues,
  confirmed,
  unconfirmed,
  onChange,
  siblings,
}: {
  node: MenuGroup | MenuControl;
  values: Record<string, number>;
  rawValues: Record<string, number[]>;
  confirmed: Record<string, number[]>;
  unconfirmed: Record<string, boolean>;
  onChange: (control: MenuControl, bytes: number[]) => void;
  siblings?: MenuControl[];
}) {
  if ("items" in node) {
    const siblingControls = node.items.filter((n): n is MenuControl => !("items" in n));
    return (
      <section className="menu-group">
        <h3 className="menu-group__title">{node.label}</h3>
        <div className="menu-group__items">
          {node.items.map((child, i) => (
            <MenuNode
              key={i}
              node={child}
              values={values}
              rawValues={rawValues}
              confirmed={confirmed}
              unconfirmed={unconfirmed}
              onChange={onChange}
              siblings={siblingControls}
            />
          ))}
        </div>
      </section>
    );
  }

  if (!evaluateShowIf(node.showIf, values)) return null;

  const brightnessSibling = siblings?.find(
    (s) => s.type === "range" && /brightness/i.test(s.label) && s.id !== node.id,
  );

  return (
    <MenuControlRow
      control={node}
      bytes={rawValues[node.id] ?? [0]}
      confirmedBytes={confirmed[node.id]}
      pending={unconfirmed[node.id] ?? false}
      onChange={onChange}
      brightnessSibling={brightnessSibling}
      brightnessValue={brightnessSibling ? (rawValues[brightnessSibling.id]?.[0] ?? 0) : undefined}
    />
  );
}

function MenuControlRow({
  control,
  bytes,
  confirmedBytes,
  pending,
  onChange,
  brightnessSibling,
  brightnessValue,
}: {
  control: MenuControl;
  bytes: number[];
  confirmedBytes: number[] | undefined;
  pending: boolean;
  onChange: (control: MenuControl, bytes: number[]) => void;
  brightnessSibling?: MenuControl;
  brightnessValue?: number;
}) {
  const value = bytes[0] ?? 0;
  const mismatch =
    confirmedBytes !== undefined && !pending && confirmedBytes.join(",") !== bytes.join(",");

  return (
    <div className="menu-control">
      <span className="menu-control__label">
        {control.label}
        {pending && <span className="menu-control__pending" title="Writing to device…" />}
        <span className="menu-control__raw" title="Value shown in this control right now">
          [{bytes.join(", ")}]
        </span>
        {mismatch && (
          <span
            className="menu-control__raw menu-control__raw--mismatch"
            title="What the device reported back after the write — doesn't match what was sent"
          >
            device: [{confirmedBytes!.join(", ")}]
          </span>
        )}
      </span>
      <div className="menu-control__input">
        {control.type === "range" && (
          <>
            <input
              type="range"
              min={Number(control.options?.[0] ?? 0)}
              max={Number(control.options?.[1] ?? 255)}
              value={value}
              onChange={(e) => onChange(control, [Number(e.target.value)])}
            />
            <span className="menu-control__value">{value}</span>
          </>
        )}

        {control.type === "dropdown" && (
          <select
            className="pill-input pill-input--select"
            value={value}
            onChange={(e) => onChange(control, [Number(e.target.value)])}
          >
            {(control.options ?? []).map((opt, i) => (
              <option key={i} value={i}>
                {String(opt)}
              </option>
            ))}
          </select>
        )}

        {control.type === "toggle" && (
          <button
            type="button"
            className={"toggle-switch" + (value ? " toggle-switch--on" : "")}
            onClick={() => onChange(control, [value ? 0 : 1])}
          >
            <span className="toggle-switch__knob" />
          </button>
        )}

        {control.type === "color" && (
          <div className="menu-control__color">
            <input
              type="color"
              value={hsvToHex(
                bytes[0] ?? 0,
                bytes[1] ?? 255,
                brightnessSibling
                  ? Math.round(
                      ((brightnessValue ?? 0) / Number(brightnessSibling.options?.[1] ?? 5)) * 255,
                    )
                  : 255,
              )}
              onChange={(e) => {
                const [h, s, v] = hexToHsv(e.target.value);
                onChange(control, [h, s]);
                // The device's hue+sat storage can't carry lightness at all —
                // it's either hardcoded to max or (for modes backed by this
                // sibling) driven entirely by the separate Brightness slider.
                // Push both together so "pick a dark/black color" actually
                // looks dark/black instead of rendering at full brightness.
                if (brightnessSibling) {
                  const max = Number(brightnessSibling.options?.[1] ?? 5);
                  const scaled = Math.round((v / 255) * max);
                  onChange(brightnessSibling, [scaled]);
                }
              }}
            />
            {brightnessSibling && (
              <span className="menu-control__color-hint">syncs {brightnessSibling.label}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
