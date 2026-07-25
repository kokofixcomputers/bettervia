import type { ViaMenuItem } from "../types/via";

export interface MenuControl {
  /** the "{id_x}" string other controls' showIf expressions reference */
  id: string;
  label: string;
  type: "range" | "dropdown" | "toggle" | "color";
  channel: number;
  valueId: number;
  showIf?: string;
  options?: (string | number)[];
}

export interface MenuGroup {
  label: string;
  items: (MenuGroup | MenuControl)[];
}

function isControlContent(content: unknown): content is [string, number, number] {
  return (
    Array.isArray(content) &&
    content.length === 3 &&
    typeof content[0] === "string" &&
    typeof content[1] === "number" &&
    typeof content[2] === "number"
  );
}

export function buildMenuTree(items: ViaMenuItem[]): (MenuGroup | MenuControl)[] {
  return items.map((item) => toNode(item)).filter((n): n is MenuGroup | MenuControl => n !== null);
}

function toNode(item: ViaMenuItem): MenuGroup | MenuControl | null {
  if (isControlContent(item.content)) {
    const [id, channel, valueId] = item.content;
    return {
      id,
      label: item.label,
      type: (item.type as MenuControl["type"]) ?? "range",
      channel,
      valueId,
      showIf: item.showIf,
      options: item.options as (string | number)[] | undefined,
    };
  }
  if (Array.isArray(item.content)) {
    const children = (item.content as ViaMenuItem[])
      .map((c) => toNode(c))
      .filter((n): n is MenuGroup | MenuControl => n !== null);
    return { label: item.label, items: children };
  }
  return null;
}

export function flattenControls(nodes: (MenuGroup | MenuControl)[]): MenuControl[] {
  const out: MenuControl[] = [];
  for (const node of nodes) {
    if ("items" in node) out.push(...flattenControls(node.items));
    else out.push(node);
  }
  return out;
}

/** Evaluates a showIf expression like "{id_a} != 0 && {id_b} == 2" against
 * a map of control id -> current raw value. OR (||) groups of AND (&&) terms. */
export function evaluateShowIf(expr: string | undefined, values: Record<string, number>): boolean {
  if (!expr) return true;
  const orGroups = expr.split("||");
  return orGroups.some((group) =>
    group
      .split("&&")
      .map((t) => t.trim())
      .every((term) => evaluateTerm(term, values)),
  );
}

function evaluateTerm(term: string, values: Record<string, number>): boolean {
  const match = term.match(/\{(\w+)\}\s*(==|!=)\s*(-?\d+)/);
  if (!match) return true;
  const [, id, op, rawNum] = match;
  const num = Number(rawNum);
  const actual = values[id] ?? 0;
  return op === "==" ? actual === num : actual !== num;
}
