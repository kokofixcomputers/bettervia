import type { CSSProperties } from "react";

export const UNIT = 54;
export const GAP = 6;

interface KeyProps {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  selected: boolean;
  isNo: boolean;
  isTrns: boolean;
  onClick: () => void;
}

export default function Key({ x, y, w, h, label, selected, isNo, isTrns, onClick }: KeyProps) {
  const style: CSSProperties = {
    position: "absolute",
    left: x * UNIT + GAP / 2,
    top: y * UNIT + GAP / 2,
    width: w * UNIT - GAP,
    height: h * UNIT - GAP,
  };

  const classes = ["key-pill"];
  if (selected) classes.push("key-pill--selected");
  if (isNo) classes.push("key-pill--empty");
  if (isTrns) classes.push("key-pill--trns");

  return (
    <button type="button" className={classes.join(" ")} style={style} onClick={onClick}>
      <span className="key-pill__label">{label}</span>
    </button>
  );
}
