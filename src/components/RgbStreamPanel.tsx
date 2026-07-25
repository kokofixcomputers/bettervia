import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViaDevice } from "../lib/hid";
import { RgbStreamClient, RgbStreamError } from "../lib/rgbStream";
import type { RgbColor, RgbStreamPong } from "../lib/rgbStream";
import air75v2Layout from "../data/led_layout_air75v2.json";
import halo75v2Layout from "../data/led_layout_halo75v2.json";

interface RgbStreamPanelProps {
  device: ViaDevice | null;
}

type SupportState = "idle" | "checking" | "supported" | "unsupported";

interface Frame {
  main: RgbColor[];
  side: RgbColor[];
}

const KNOWN_LAYOUTS: Record<number, [number, number][]> = {
  84: air75v2Layout as [number, number][],
  83: halo75v2Layout as [number, number][],
};

// Side/logo strip is one contiguous index range (0..N-1) in the protocol,
// but it's physically two separate zones: a visible side-profile strip and
// a logo/ambient underlight, at different boundaries per board (Air75 V2:
// 6 + 6 = 12; Halo75 V2: 5 + 40 = 45 — see side.c's SIDE_LINE/LOGO_LINE vs.
// SIDE_LED_COUNT/AMBIENT_LED_COUNT). Falls back to an even split if some
// other board reports a different total.
const SIDE_STRIP_SPLIT: Record<number, number> = { 12: 6, 45: 5 };

function sideProfileCount(total: number): number {
  return SIDE_STRIP_SPLIT[total] ?? Math.ceil(total / 2);
}

function fallbackLayout(count: number): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count * 3));
  return Array.from({ length: count }, (_, i) => [(i % cols) * 10, Math.floor(i / cols) * 10]);
}

function hexToRgb(hex: string): RgbColor {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(c: RgbColor): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function rgbToRgba(c: RgbColor, alpha: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

function scaleColor(c: RgbColor, brightness: number): RgbColor {
  const f = brightness / 255;
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
}

function blankFrame(mainCount: number, sideCount: number): Frame {
  return {
    main: Array.from({ length: mainCount }, () => ({ ...BLACK })),
    side: Array.from({ length: sideCount }, () => ({ ...BLACK })),
  };
}

function cloneFrame(f: Frame): Frame {
  return { main: f.main.map((c) => ({ ...c })), side: f.side.map((c) => ({ ...c })) };
}

export default function RgbStreamPanel({ device }: RgbStreamPanelProps) {
  const client = useMemo(() => (device ? new RgbStreamClient(device) : null), [device]);

  const [support, setSupport] = useState<SupportState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pong, setPong] = useState<RgbStreamPong | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [battery, setBattery] = useState<number | null>(null);
  const [brightness, setBrightness] = useState(255);
  // The protocol's SET_BRIGHTNESS (0x16) scales the main matrix only — there
  // is no hardware brightness command for the side/logo strip, so this is
  // applied client-side by scaling every side color before it's sent.
  const [sideBrightness, setSideBrightness] = useState(255);
  const [brushColor, setBrushColor] = useState("#12b886");

  // ---- Animation model: a list of frames, one editable at a time, that
  // loop on playback. ----
  const [frames, setFrames] = useState<Frame[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameMs, setFrameMs] = useState(200);
  const [onionSkin, setOnionSkin] = useState(true);
  const [onionOpacity, setOnionOpacity] = useState(0.35);

  const framesRef = useRef(frames);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);
  const sideBrightnessRef = useRef(sideBrightness);
  useEffect(() => {
    sideBrightnessRef.current = sideBrightness;
  }, [sideBrightness]);

  const paintingRef = useRef(false);

  const frame = frames[currentFrame];
  const mainColors = frame?.main ?? [];
  const sideColors = frame?.side ?? [];
  const previousFrame = frames.length > 1 ? frames[(currentFrame - 1 + frames.length) % frames.length] : undefined;

  const layout = useMemo(() => {
    if (!pong) return [];
    return KNOWN_LAYOUTS[pong.mainLedCount] ?? fallbackLayout(pong.mainLedCount);
  }, [pong]);

  const bounds = useMemo(() => {
    if (layout.length === 0) return { w: 160, h: 60 };
    const xs = layout.map((p) => p[0]);
    const ys = layout.map((p) => p[1]);
    return { w: Math.max(...xs) + 10, h: Math.max(...ys) + 10 };
  }, [layout]);

  useEffect(() => {
    setSupport("idle");
    setPong(null);
    setStreaming(false);
    setPlaying(false);
    setError(null);
    setFrames([]);
    setCurrentFrame(0);
  }, [device]);

  // Keep currentFrame valid if the frame list shrinks (e.g. deleting the last frame).
  useEffect(() => {
    if (frames.length > 0 && currentFrame >= frames.length) setCurrentFrame(frames.length - 1);
  }, [frames.length, currentFrame]);

  const detect = useCallback(async () => {
    if (!client) return;
    setSupport("checking");
    setError(null);
    try {
      const p = await client.ping();
      setPong(p);
      setFrames([blankFrame(p.mainLedCount, p.sideLedCount)]);
      setCurrentFrame(0);
      setSupport("supported");
    } catch (err) {
      setSupport("unsupported");
      setError(
        err instanceof RgbStreamError
          ? err.message
          : "No response — this requires the `ryodeushii` keymap over a USB cable (not wireless).",
      );
    }
  }, [client]);

  const stopPlayback = useCallback(() => setPlaying(false), []);

  const toggleStreaming = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      if (!streaming) {
        await client.selectHostStreamEffect();
        await client.setHostMode(true);
        if (pong && pong.sideLedCount > 0) await client.setSideHostMode(true);
        await client.setBrightness(brightness);
        setStreaming(true);
      } else {
        stopPlayback();
        await client.setHostMode(false);
        if (pong && pong.sideLedCount > 0) await client.setSideHostMode(false);
        setStreaming(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, streaming, pong, brightness, stopPlayback]);

  // Best-effort: hand control back to the keyboard's own lighting if the
  // panel unmounts (tab switch, disconnect) while streaming was left on.
  useEffect(() => {
    return () => {
      if (streaming && client) {
        client.setHostMode(false).catch(() => undefined);
        client.setSideHostMode(false).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  // Live preview while editing (not playing): debounced push of the frame
  // currently being painted.
  const pushDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFrame = useCallback(
    (main: RgbColor[], side: RgbColor[]) => {
      if (!client || !streaming || playing) return;
      if (pushDebounce.current) clearTimeout(pushDebounce.current);
      pushDebounce.current = setTimeout(async () => {
        try {
          await client.setLedChunk(0, main);
          await client.commit();
          if (side.length > 0) {
            const scaledSide = side.map((c) => scaleColor(c, sideBrightness));
            await client.setSideLedChunk(0, scaledSide);
            await client.sideCommit();
          }
        } catch {
          // best effort — a dropped frame during fast painting isn't worth surfacing
        }
      }, 30);
    },
    [client, streaming, playing, sideBrightness],
  );

  // Re-push the current frame whenever the client-side side-brightness
  // scalar changes, so dragging the slider previews live.
  useEffect(() => {
    if (streaming && !playing) pushFrame(mainColors, sideColors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideBrightness]);

  // Playback loop: advances currentFrame and streams that frame, looping
  // forever until stopped. Restarts cleanly whenever speed changes.
  useEffect(() => {
    if (!playing || !client) return;
    const id = setInterval(() => {
      setCurrentFrame((prevIdx) => {
        const fs = framesRef.current;
        if (fs.length === 0) return prevIdx;
        const nextIdx = (prevIdx + 1) % fs.length;
        const f = fs[nextIdx];
        client
          .setLedChunk(0, f.main)
          .then(() => client.commit())
          .catch(() => undefined);
        if (f.side.length > 0) {
          const scaled = f.side.map((c) => scaleColor(c, sideBrightnessRef.current));
          client
            .setSideLedChunk(0, scaled)
            .then(() => client.sideCommit())
            .catch(() => undefined);
        }
        return nextIdx;
      });
    }, frameMs);
    return () => clearInterval(id);
  }, [playing, frameMs, client]);

  const updateCurrentFrame = useCallback(
    (updater: (f: Frame) => Frame) => {
      setFrames((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        next[currentFrame] = updater(next[currentFrame]);
        return next;
      });
    },
    [currentFrame],
  );

  const paintMain = useCallback(
    (index: number, color: RgbColor) => {
      updateCurrentFrame((f) => {
        const nextMain = [...f.main];
        nextMain[index] = color;
        pushFrame(nextMain, f.side);
        return { ...f, main: nextMain };
      });
    },
    [updateCurrentFrame, pushFrame],
  );

  const paintSide = useCallback(
    (index: number, color: RgbColor) => {
      updateCurrentFrame((f) => {
        const nextSide = [...f.side];
        nextSide[index] = color;
        pushFrame(f.main, nextSide);
        return { ...f, side: nextSide };
      });
    },
    [updateCurrentFrame, pushFrame],
  );

  const fillMain = useCallback(
    (color: RgbColor) => {
      updateCurrentFrame((f) => {
        const nextMain = f.main.map(() => ({ ...color }));
        pushFrame(nextMain, f.side);
        return { ...f, main: nextMain };
      });
    },
    [updateCurrentFrame, pushFrame],
  );

  const fillSide = useCallback(
    (color: RgbColor) => {
      updateCurrentFrame((f) => {
        const nextSide = f.side.map(() => ({ ...color }));
        pushFrame(f.main, nextSide);
        return { ...f, side: nextSide };
      });
    },
    [updateCurrentFrame, pushFrame],
  );

  const fillSideRange = useCallback(
    (start: number, end: number, color: RgbColor) => {
      updateCurrentFrame((f) => {
        const nextSide = f.side.map((c, i) => (i >= start && i < end ? { ...color } : c));
        pushFrame(f.main, nextSide);
        return { ...f, side: nextSide };
      });
    },
    [updateCurrentFrame, pushFrame],
  );

  const applyCheckerboard = useCallback(() => {
    const a = hexToRgb(brushColor);
    updateCurrentFrame((f) => {
      const nextMain = f.main.map((_, i) => ({ ...(i % 2 === 0 ? a : BLACK) }));
      pushFrame(nextMain, f.side);
      return { ...f, main: nextMain };
    });
  }, [brushColor, updateCurrentFrame, pushFrame]);

  // ---- Frame management ----

  const selectFrame = useCallback(
    (index: number) => {
      stopPlayback();
      setCurrentFrame(index);
    },
    [stopPlayback],
  );

  const addFrame = useCallback(() => {
    stopPlayback();
    setFrames((prev) => {
      const source = prev[currentFrame];
      if (!source) return prev;
      const next = [...prev];
      next.splice(currentFrame + 1, 0, cloneFrame(source));
      return next;
    });
    setCurrentFrame((i) => i + 1);
  }, [currentFrame, stopPlayback]);

  const deleteFrame = useCallback(() => {
    if (frames.length <= 1) return;
    stopPlayback();
    setFrames((prev) => prev.filter((_, i) => i !== currentFrame));
    setCurrentFrame((i) => Math.max(0, i - 1));
  }, [frames.length, currentFrame, stopPlayback]);

  /** Appends a simple "one lit LED marching across the main matrix" sequence
   * after the current frame, in the brush color — a quick way to get a
   * playable animation going without hand-drawing every frame. */
  const insertChaseFrames = useCallback(() => {
    if (!pong) return;
    stopPlayback();
    const color = hexToRgb(brushColor);
    const generated: Frame[] = Array.from({ length: pong.mainLedCount }, (_, pos) => ({
      main: Array.from({ length: pong.mainLedCount }, (_, i) => (i === pos ? { ...color } : { ...BLACK })),
      side: frames[currentFrame]?.side.map((c) => ({ ...c })) ?? Array.from({ length: pong.sideLedCount }, () => ({ ...BLACK })),
    }));
    setFrames((prev) => {
      const next = [...prev];
      next.splice(currentFrame + 1, 0, ...generated);
      return next;
    });
    setCurrentFrame((i) => i + 1);
  }, [pong, brushColor, frames, currentFrame, stopPlayback]);

  const refreshBattery = useCallback(async () => {
    if (!client) return;
    try {
      setBattery(await client.getBatteryPercent());
    } catch {
      // ignore
    }
  }, [client]);

  if (!device || !client) {
    return <div className="menu-panel menu-panel--disconnected">Connect a device to try RGB streaming.</div>;
  }

  const showOnion = onionSkin && !playing && !!previousFrame;

  return (
    <div className="menu-panel rgb-stream">
      <section className="menu-group">
        <h3 className="menu-group__title">Host RGB Stream</h3>
        <p className="rgb-stream__blurb">
          A custom protocol some NuPhy boards' community firmware exposes for pushing arbitrary per-LED
          colors from this browser, layered alongside VIA. Requires the <code>ryodeushii</code> keymap
          and a <strong>USB cable</strong> — it doesn't work over the wireless dongle or Bluetooth.
        </p>

        {support !== "supported" && (
          <button className="pill-btn" type="button" disabled={support === "checking"} onClick={detect}>
            {support === "checking" ? "Checking…" : "Detect Support"}
          </button>
        )}

        {support === "unsupported" && <div className="rgb-stream__error">{error}</div>}

        {support === "supported" && pong && (
          <>
            <div className="rgb-stream__meta">
              <span>protocol v{pong.protocolVersion}</span>
              <span>{pong.mainLedCount} main LEDs</span>
              <span>{pong.sideLedCount} side LEDs</span>
              {battery !== null && <span>{battery}% battery</span>}
              <button className="pill-btn" type="button" onClick={refreshBattery}>
                Read battery
              </button>
            </div>

            <div className="menu-control">
              <span className="menu-control__label">Streaming mode</span>
              <div className="menu-control__input">
                <button
                  type="button"
                  disabled={busy}
                  className={"toggle-switch" + (streaming ? " toggle-switch--on" : "")}
                  onClick={toggleStreaming}
                >
                  <span className="toggle-switch__knob" />
                </button>
              </div>
            </div>

            {streaming && (
              <div className="menu-control">
                <span className="menu-control__label">Brightness</span>
                <div className="menu-control__input">
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={brightness}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBrightness(v);
                      client.setBrightness(v).catch(() => undefined);
                    }}
                  />
                  <span className="menu-control__value">{brightness}</span>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {support === "supported" && pong && streaming && (
        <>
          <section className="menu-group">
            <h3 className="menu-group__title">Animation</h3>

            <div className="rgb-stream__filmstrip">
              {frames.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  className={"rgb-stream__frame-thumb" + (i === currentFrame ? " rgb-stream__frame-thumb--active" : "")}
                  onClick={() => selectFrame(i)}
                  title={`Frame ${i + 1}`}
                >
                  <svg viewBox={`-5 -5 ${bounds.w} ${bounds.h}`}>
                    {layout.map(([x, y], li) => (
                      <circle key={li} cx={x} cy={y} r={6} fill={rgbToHex(f.main[li] ?? BLACK)} />
                    ))}
                  </svg>
                  <span className="rgb-stream__frame-thumb__num">{i + 1}</span>
                </button>
              ))}
              <button className="rgb-stream__frame-add" type="button" onClick={addFrame} title="Duplicate current frame">
                +
              </button>
              <button
                className="rgb-stream__frame-add"
                type="button"
                onClick={deleteFrame}
                disabled={frames.length <= 1}
                title="Delete current frame"
              >
                −
              </button>
            </div>

            <div className="rgb-stream__toolbar">
              <button
                className={"pill-btn" + (playing ? " pill-btn--primary" : "")}
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={frames.length < 2}
              >
                {playing ? "Stop" : "Play Loop"}
              </button>
              <label className="rgb-stream__inline-label">
                Speed
                <input
                  type="range"
                  min={30}
                  max={1000}
                  step={10}
                  value={frameMs}
                  onChange={(e) => setFrameMs(Number(e.target.value))}
                />
                <span className="menu-control__value">{frameMs}ms</span>
              </label>
              <button className="pill-btn" type="button" onClick={insertChaseFrames}>
                Generate Chase
              </button>
            </div>

            <div className="rgb-stream__toolbar">
              <label className="rgb-stream__inline-label">
                <input
                  type="checkbox"
                  checked={onionSkin}
                  onChange={(e) => setOnionSkin(e.target.checked)}
                />
                Onion skin
              </label>
              {onionSkin && (
                <label className="rgb-stream__inline-label">
                  Opacity
                  <input
                    type="range"
                    min={0.1}
                    max={0.8}
                    step={0.05}
                    value={onionOpacity}
                    onChange={(e) => setOnionOpacity(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          </section>

          <section className="menu-group">
            <h3 className="menu-group__title">Pattern editor — frame {currentFrame + 1} of {frames.length}</h3>
            <div className="rgb-stream__toolbar">
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                title="Brush color"
              />
              <button className="pill-btn" type="button" onClick={() => fillMain(hexToRgb(brushColor))} disabled={playing}>
                Fill All
              </button>
              <button className="pill-btn" type="button" onClick={() => fillMain(BLACK)} disabled={playing}>
                Clear
              </button>
              <button className="pill-btn" type="button" onClick={applyCheckerboard} disabled={playing}>
                Checkerboard
              </button>
            </div>

            <svg
              className={"rgb-stream__grid" + (playing ? " rgb-stream__grid--locked" : "")}
              viewBox={`-5 -5 ${bounds.w} ${bounds.h}`}
              onMouseUp={() => (paintingRef.current = false)}
              onMouseLeave={() => (paintingRef.current = false)}
            >
              {showOnion &&
                layout.map(([x, y], i) => (
                  <circle
                    key={`ghost-${i}`}
                    cx={x}
                    cy={y}
                    r={6.5}
                    className="rgb-stream__led-ghost"
                    fill={rgbToHex(previousFrame!.main[i] ?? BLACK)}
                    opacity={onionOpacity}
                  />
                ))}
              {layout.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={4.2}
                  className="rgb-stream__led"
                  fill={rgbToHex(mainColors[i] ?? BLACK)}
                  onMouseDown={() => {
                    if (playing) return;
                    paintingRef.current = true;
                    paintMain(i, hexToRgb(brushColor));
                  }}
                  onMouseEnter={() => {
                    if (playing) return;
                    if (paintingRef.current) paintMain(i, hexToRgb(brushColor));
                  }}
                />
              ))}
            </svg>
          </section>

          {pong.sideLedCount > 0 &&
            (() => {
              const profileCount = sideProfileCount(pong.sideLedCount);
              const zones: [string, number, number][] = [
                ["Side profile", 0, profileCount],
                ["Logo / ambient", profileCount, pong.sideLedCount],
              ];
              return (
                <section className="menu-group">
                  <h3 className="menu-group__title">Side / logo strip</h3>

                  <div className="menu-control">
                    <span className="menu-control__label">
                      Side Brightness
                      <span
                        className="menu-control__raw"
                        title="Not a hardware command — the protocol only exposes brightness for the main matrix. This scales side/logo colors client-side before every send."
                      >
                        app-side only
                      </span>
                    </span>
                    <div className="menu-control__input">
                      <input
                        type="range"
                        min={0}
                        max={255}
                        value={sideBrightness}
                        onChange={(e) => setSideBrightness(Number(e.target.value))}
                      />
                      <span className="menu-control__value">{sideBrightness}</span>
                    </div>
                  </div>

                  <div className="rgb-stream__toolbar">
                    <button className="pill-btn" type="button" onClick={() => fillSide(hexToRgb(brushColor))} disabled={playing}>
                      Fill Both
                    </button>
                    <button className="pill-btn" type="button" onClick={() => fillSide(BLACK)} disabled={playing}>
                      Clear Both
                    </button>
                  </div>
                  {zones.map(([label, start, end]) => (
                    <div key={label} className="rgb-stream__zone">
                      <div className="rgb-stream__zone-header">
                        <span>
                          {label} ({end - start} LEDs)
                        </span>
                        <div className="rgb-stream__toolbar rgb-stream__toolbar--tight">
                          <button
                            className="pill-btn"
                            type="button"
                            onClick={() => fillSideRange(start, end, hexToRgb(brushColor))}
                            disabled={playing}
                          >
                            Fill
                          </button>
                          <button
                            className="pill-btn"
                            type="button"
                            onClick={() => fillSideRange(start, end, BLACK)}
                            disabled={playing}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="rgb-stream__side-strip">
                        {sideColors.slice(start, end).map((c, offset) => {
                          const i = start + offset;
                          const ghost = showOnion ? previousFrame!.side[i] : undefined;
                          return (
                            <button
                              key={i}
                              type="button"
                              className="rgb-stream__side-led"
                              style={{
                                background: rgbToHex(c),
                                boxShadow: ghost ? `0 0 0 4px ${rgbToRgba(ghost, onionOpacity)}` : undefined,
                              }}
                              disabled={playing}
                              onMouseDown={() => {
                                if (playing) return;
                                paintingRef.current = true;
                                paintSide(i, hexToRgb(brushColor));
                              }}
                              onMouseEnter={() => {
                                if (playing) return;
                                if (paintingRef.current) paintSide(i, hexToRgb(brushColor));
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })()}
        </>
      )}
    </div>
  );
}
