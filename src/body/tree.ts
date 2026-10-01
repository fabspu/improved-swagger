// Editable JSON tree where every object field / array item can be switched off.

export type BodyNode =
  | { kind: 'object'; fields: BodyField[] }
  | { kind: 'array'; items: BodyItem[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string } // kept as text while editing
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' };

export interface BodyField {
  key: string;
  enabled: boolean;
  node: BodyNode;
}

export interface BodyItem {
  enabled: boolean;
  node: BodyNode;
}

/** Address of a node: object keys (string) and array indices (number). */
export type NodePath = (string | number)[];

export function fromValue(value: unknown): BodyNode {
  if (value === null || value === undefined) return { kind: 'null' };
  if (Array.isArray(value)) return { kind: 'array', items: value.map((v) => ({ enabled: true, node: fromValue(v) })) };
  switch (typeof value) {
    case 'object':
      return { kind: 'object', fields: Object.entries(value).map(([key, v]) => ({ key, enabled: true, node: fromValue(v) })) };
    case 'number':
      return { kind: 'number', value: String(value) };
    case 'boolean':
      return { kind: 'boolean', value };
    default:
      return { kind: 'string', value: String(value) };
  }
}

export function toValue(node: BodyNode): unknown {
  switch (node.kind) {
    case 'object':
      return Object.fromEntries(node.fields.filter((f) => f.enabled).map((f) => [f.key, toValue(f.node)]));
    case 'array':
      return node.items.filter((i) => i.enabled).map((i) => toValue(i.node));
    case 'number': {
      const n = Number(node.value);
      return node.value.trim() !== '' && Number.isFinite(n) ? n : node.value;
    }
    case 'string':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
  }
}

/** Immutable update of the node at `path`. */
export function updateAt(root: BodyNode, path: NodePath, fn: (n: BodyNode) => BodyNode): BodyNode {
  if (path.length === 0) return fn(root);
  const [head, ...rest] = path;
  if (root.kind === 'object' && typeof head === 'string') {
    return { ...root, fields: root.fields.map((f) => (f.key === head ? { ...f, node: updateAt(f.node, rest, fn) } : f)) };
  }
  if (root.kind === 'array' && typeof head === 'number') {
    return { ...root, items: root.items.map((it, i) => (i === head ? { ...it, node: updateAt(it.node, rest, fn) } : it)) };
  }
  return root;
}

/** Toggles the field/item addressed by `path` (the last segment names the entry in its parent). */
export function setEnabled(root: BodyNode, path: NodePath, enabled: boolean): BodyNode {
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  return updateAt(root, parent, (n) => {
    if (n.kind === 'object') return { ...n, fields: n.fields.map((f) => (f.key === last ? { ...f, enabled } : f)) };
    if (n.kind === 'array') return { ...n, items: n.items.map((it, i) => (i === last ? { ...it, enabled } : it)) };
    return n;
  });
}

/**
 * Writes a plain value at a dot path of object keys (used by the field mapping).
 * Missing intermediate objects are created, and every entry on the way is enabled.
 */
export function setValueAtDotPath(root: BodyNode, dotPath: string, value: unknown): BodyNode {
  const keys = dotPath.split('.');
  const write = (node: BodyNode, i: number): BodyNode => {
    if (i === keys.length) return fromValue(value);
    const obj = node.kind === 'object' ? node : { kind: 'object' as const, fields: [] };
    const key = keys[i];
    const existing = obj.fields.find((f) => f.key === key);
    const child = write(existing?.node ?? { kind: 'null' }, i + 1);
    const fields = existing
      ? obj.fields.map((f) => (f.key === key ? { ...f, enabled: true, node: child } : f))
      : [...obj.fields, { key, enabled: true, node: child }];
    return { kind: 'object', fields };
  };
  return write(root, 0);
}

/** Disables the fields at the given dot paths (e.g. readOnly fields of the schema). */
export function disablePaths(root: BodyNode, dotPaths: string[]): BodyNode {
  let out = root;
  for (const p of dotPaths) out = setEnabled(out, p.split('.'), false);
  return out;
}

/** After raw JSON editing: keep previously disabled fields around (still disabled) so they can be re-enabled. */
export function mergeDisabled(prev: BodyNode, next: BodyNode): BodyNode {
  if (prev.kind !== 'object' || next.kind !== 'object') return next;
  const fields = next.fields.map((f) => {
    const old = prev.fields.find((o) => o.key === f.key);
    return old ? { ...f, node: mergeDisabled(old.node, f.node) } : f;
  });
  for (const old of prev.fields) {
    if (!old.enabled && !fields.some((f) => f.key === old.key)) fields.push(old);
  }
  return { kind: 'object', fields };
}
