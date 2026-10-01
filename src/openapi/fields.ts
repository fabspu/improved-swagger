import { deref, normalizeSchema, schemaType, type OpenApiDoc, type Schema } from './spec';

export interface FieldInfo {
  /** Dot path of object keys, e.g. "dimensions.width". */
  path: string;
  type: string;
  required: boolean;
  readOnly: boolean;
  description?: string;
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
}

/** Flattens the object properties of a schema (recursively into nested objects, arrays are leaves). */
export function flattenFields(doc: OpenApiDoc, schema: Schema | undefined, prefix = '', seen: string[] = []): FieldInfo[] {
  const s = normalizeSchema(doc, schema);
  if (!s || schemaType(s) !== 'object' || prefix.split('.').length > 5) return [];
  const out: FieldInfo[] = [];
  for (const [key, raw] of Object.entries(s.properties ?? {})) {
    const ref = raw.$ref;
    const prop = normalizeSchema(doc, raw)!;
    const path = prefix ? `${prefix}.${key}` : key;
    const type = schemaType(prop);
    out.push({
      path,
      type: type === 'array' ? `${schemaType(deref(doc, prop.items))}[]` : type,
      required: !!s.required?.includes(key),
      readOnly: !!(prop.readOnly || deref(doc, raw).readOnly),
      description: prop.description,
      format: prop.format,
      enum: prop.enum,
      nullable: prop.nullable,
    });
    if (type === 'object' && !(ref && seen.includes(ref))) {
      out.push(...flattenFields(doc, prop, path, ref ? [...seen, ref] : seen));
    }
  }
  return out;
}

/** Fallback when no schema is known (e.g. inline response): derive fields from a captured value. */
export function flattenValue(value: unknown, prefix = ''): FieldInfo[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: FieldInfo[] = [];
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    out.push({ path, type, required: false, readOnly: false });
    if (type === 'object') out.push(...flattenValue(v, path));
  }
  return out;
}

export function getAtPath(value: unknown, path: string): unknown {
  let cur = value;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Suggests source fields for target fields: exact path, then same leaf name (case-insensitive). */
export function autoMatch(target: FieldInfo[], source: FieldInfo[]): Record<string, string> {
  const result: Record<string, string> = {};
  const leaf = (p: string) => p.split('.').pop()!.toLowerCase();
  for (const t of target) {
    const exact = source.find((s) => s.path === t.path);
    const byLeaf = source.filter((s) => leaf(s.path) === leaf(t.path));
    const match = exact ?? (byLeaf.length === 1 ? byLeaf[0] : undefined);
    if (match) result[t.path] = match.path;
  }
  // Don't map a parent object and its children at the same time: prefer the children.
  for (const path of Object.keys(result)) {
    if (Object.keys(result).some((other) => other.startsWith(path + '.'))) delete result[path];
  }
  return result;
}
