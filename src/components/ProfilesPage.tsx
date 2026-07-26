import { useState } from "react";
import type { ViaDefinition } from "../types/via";
import type { DeviceProfiles, Profile, RgbStreamState } from "../lib/tauriSettings";

interface ProfilesPageProps {
  deviceKey: string | null;
  definition: ViaDefinition | null;
  keymap: number[][][];
  currentRgbState: RgbStreamState | undefined;
  deviceProfiles: DeviceProfiles | undefined;
  onSaveProfiles: (key: string, profiles: DeviceProfiles) => void;
  onApplyProfile: (profile: Profile) => void;
}

type RgbChoice = "current" | "builtin" | "off";

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function ProfilesPage({
  deviceKey,
  definition,
  keymap,
  currentRgbState,
  deviceProfiles,
  onSaveProfiles,
  onApplyProfile,
}: ProfilesPageProps) {
  const [name, setName] = useState("");
  const [includeKeymap, setIncludeKeymap] = useState(true);
  const [rgbChoice, setRgbChoice] = useState<RgbChoice>("current");
  const [builtInEffect, setBuiltInEffect] = useState(1);

  if (!deviceKey || !definition) {
    return (
      <div className="menu-panel">
        <section className="glass-card">
          <p className="rgb-stream__blurb">Connect a recognized keyboard to create and switch profiles for it.</p>
        </section>
      </div>
    );
  }

  const list = deviceProfiles?.list ?? [];

  const createProfile = () => {
    if (!name.trim()) return;
    const profile: Profile = {
      id: makeId(),
      name: name.trim(),
      keymap: includeKeymap ? keymap.map((l) => l.map((r) => [...r])) : undefined,
      rgbStream: rgbChoice === "current" ? currentRgbState : rgbChoice === "off" ? { ...OFF_STATE } : undefined,
      builtInEffect: rgbChoice === "builtin" ? builtInEffect : undefined,
    };
    onSaveProfiles(deviceKey, { list: [...list, profile], activeId: deviceProfiles?.activeId });
    setName("");
  };

  const deleteProfile = (id: string) => {
    onSaveProfiles(deviceKey, {
      list: list.filter((p) => p.id !== id),
      activeId: deviceProfiles?.activeId === id ? undefined : deviceProfiles?.activeId,
    });
  };

  const applyProfile = (profile: Profile) => {
    onApplyProfile(profile);
    onSaveProfiles(deviceKey, { list, activeId: profile.id });
  };

  return (
    <div className="menu-panel profiles-page">
      <section className="glass-card">
        <h3 className="glass-card__title">Profiles</h3>
        <p className="rgb-stream__blurb">
          A profile bundles a keymap snapshot with an RGB setup — a custom animation, a built-in QMK
          effect, or RGB off entirely. Save your current setup as a profile, build another with
          different keys and lighting, then switch between them instantly. For example: one profile
          for basic animations, another with remapped keys and RGB left on a built-in effect.
        </p>

        <div className="profiles-form">
          <input
            className="pill-input"
            placeholder="Profile name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="rgb-stream__inline-label">
            <input type="checkbox" checked={includeKeymap} onChange={(e) => setIncludeKeymap(e.target.checked)} />
            Include current keymap
          </label>

          <div className="profiles-rgb-choice">
            <span className="menu-control__label">RGB</span>
            <label className="rgb-stream__inline-label">
              <input
                type="radio"
                name="rgbChoice"
                checked={rgbChoice === "current"}
                onChange={() => setRgbChoice("current")}
              />
              Current animation
            </label>
            <label className="rgb-stream__inline-label">
              <input
                type="radio"
                name="rgbChoice"
                checked={rgbChoice === "builtin"}
                onChange={() => setRgbChoice("builtin")}
              />
              Built-in effect
              {rgbChoice === "builtin" && (
                <input
                  className="pill-input profiles-effect-input"
                  type="number"
                  min={0}
                  max={60}
                  value={builtInEffect}
                  onChange={(e) => setBuiltInEffect(Number(e.target.value))}
                  title="Index into the board's Lighting → Effect dropdown"
                />
              )}
            </label>
            <label className="rgb-stream__inline-label">
              <input type="radio" name="rgbChoice" checked={rgbChoice === "off"} onChange={() => setRgbChoice("off")} />
              Off
            </label>
          </div>

          <button className="pill-btn pill-btn--primary" type="button" onClick={createProfile} disabled={!name.trim()}>
            Save as New Profile
          </button>
        </div>
      </section>

      <section className="glass-card">
        <h3 className="glass-card__title">
          Saved ({list.length})
        </h3>
        {list.length === 0 ? (
          <p className="rgb-stream__blurb">No profiles yet — create one above.</p>
        ) : (
          <div className="library-list">
            {list.map((p) => (
              <div key={p.id} className="library-row">
                <div className="library-row__info">
                  <span className="library-row__name">
                    {p.name} {deviceProfiles?.activeId === p.id && <span className="profile-badge">active</span>}
                  </span>
                  <span className="menu-control__raw">
                    {p.keymap ? "keymap" : "no keymap"} ·{" "}
                    {p.rgbStream?.streaming ? `${p.rgbStream.frames.length}-frame animation` : p.builtInEffect !== undefined ? `built-in effect ${p.builtInEffect}` : "RGB off"}
                  </span>
                </div>
                <div className="rgb-stream__toolbar rgb-stream__toolbar--tight">
                  <button className="pill-btn" type="button" onClick={() => applyProfile(p)}>
                    Apply
                  </button>
                  <button className="pill-btn pill-btn--danger" type="button" onClick={() => deleteProfile(p.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const OFF_STATE: RgbStreamState = {
  streaming: false,
  playing: false,
  frames: [],
  currentFrame: 0,
  frameMs: 200,
  brightness: 255,
  sideBrightness: 255,
};
