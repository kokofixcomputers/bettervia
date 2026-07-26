// Small, consistent line icons for the sidebar nav — plain inline SVG,
// no icon-library dependency. 20x20, stroke = currentColor.

import { useMemo } from "react";

type IconProps = { className?: string };
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

let appIconGradientId = 0;

/** The app's own logo (matches the generated Tauri app icon / favicon.svg —
 * same gradient rounded square + "K" glyph) rendered inline so it stays
 * crisp at sidebar size without an extra image request. */
export function AppIcon({ size = 28, className }: { size?: number; className?: string }) {
  const id = useMemo(() => `app-icon-g-${appIconGradientId++}`, []);
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} className={className}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect x="40" y="40" width="944" height="944" rx="220" fill={`url(#${id})`} />
      <path
        d="M382 328c17.7 0 32 14.3 32 32v120.7l137.4-142.7c12.3-12.8 32.6-13.1 45.3-.9s13.1 32.6.9 45.3L473.8 512l123.8 129.6c12.2 12.7 11.7 33-1 45.3s-33 11.7-45.3-1L414 543.3V664c0 17.7-14.3 32-32 32s-32-14.3-32-32V360c0-17.7 14.3-32 32-32z"
        fill="#ffffff"
      />
    </svg>
  );
}

export function IconKeymap({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="20" height="20">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 9h.01M11 9h.01M15 9h.01M17 9h.01M7 13h10M7 15.5h.01M20 15.5h.01" />
    </svg>
  );
}

export function IconBulb({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="20" height="20">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.7v.5h5.6v-.5c0-.7.3-1.3.8-1.7A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

export function IconWave({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="20" height="20">
      <path d="M2 12h3l2-7 3 14 3-10 2 3h7" />
    </svg>
  );
}

export function IconLayers({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="20" height="20">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 13l9 5 9-5M3 17.5l9 5 9-5" />
    </svg>
  );
}

export function IconBook({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="20" height="20">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </svg>
  );
}

export function IconPlug({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="16" height="16">
      <path d="M9 2v4M15 2v4M7 6h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V6Z" />
      <path d="M12 14v4M9 21h6" />
    </svg>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="16" height="16">
      <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function IconUpload({ className }: IconProps) {
  return (
    <svg {...base} className={className} width="16" height="16">
      <path d="M12 21V9m0 0 4 4m-4-4-4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Battery outline with an inner fill sized to `percent` (0-100). Not part
 * of VIA itself — only meaningful when the connected board's firmware
 * answers the custom RGB-stream protocol's battery query. */
export function IconBattery({ percent, className }: IconProps & { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const innerWidth = 15.6;
  const fillWidth = Math.max(1, (innerWidth * clamped) / 100);
  const fillColor = clamped <= 15 ? "#ef4444" : clamped <= 30 ? "#f59e0b" : "#22c55e";
  return (
    <svg viewBox="0 0 26 14" width="24" height="13" className={className}>
      <rect x="1" y="1" width="20" height="12" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="22.2" y="4.4" width="2.3" height="5.2" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="3.2" y="3.2" width={fillWidth} height="7.6" rx="1.3" fill={fillColor} />
    </svg>
  );
}
