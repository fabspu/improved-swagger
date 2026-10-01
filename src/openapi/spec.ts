// Loose OpenAPI 3.x / Swagger 2.0 model. Only the parts the UI needs are typed.

export interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  required?: string[];
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  enum?: unknown[];
  example?: unknown;
  examples?: unknown[];
  default?: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
}

export interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, Schema>; [k: string]: unknown };
  definitions?: Record<string, Schema>;
}

export type ParamLocation = 'path' | 'query' | 'header' | 'cookie';

export interface Parameter {
  name: string;
  in: ParamLocation;
  required: boolean;
  description?: string;
  schema?: Schema;
}

export interface RequestBodyInfo {
  contentType: string;
  required: boolean;
  description?: string;
  schema?: Schema;
  example?: unknown;
}

export interface ResponseInfo {
  status: string;
  description?: string;
  contentType?: string;
  schema?: Schema;
  example?: unknown;
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated: boolean;
  parameters: Parameter[];
  requestBody?: RequestBodyInfo;
  responses: ResponseInfo[];
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

type Obj = Record<string, unknown>;

export function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined; // external refs are not supported yet
  let cur: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[key];
  }
  return cur;
}

/** Follows $ref chains (schemas, parameters, responses, request bodies). */
export function deref<T>(doc: OpenApiDoc, value: T): T {
  let cur: unknown = value;
  for (let i = 0; i < 20 && cur && typeof cur === 'object' && '$ref' in (cur as Obj); i++) {
    const next = resolvePointer(doc, (cur as Obj).$ref as string);
    if (next === undefined) break;
    cur = next;
  }
  return cur as T;
}

export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref;
}

/** Derefs a schema and merges allOf parts; oneOf/anyOf collapse to their first option. */
export function normalizeSchema(doc: OpenApiDoc, schema: Schema | undefined, depth = 0): Schema | undefined {
  if (!schema || depth > 10) return schema;
  const s = deref(doc, schema);
  if (s.allOf?.length) {
    const merged: Schema = { ...s, allOf: undefined, properties: { ...s.properties }, required: [...(s.required ?? [])] };
    for (const part of s.allOf) {
      const p = normalizeSchema(doc, part, depth + 1);
      if (!p) continue;
      Object.assign(merged.properties!, p.properties);
      merged.required!.push(...(p.required ?? []));
      merged.type ??= p.type;
      merged.description ??= p.description;
    }
    return merged;
  }
  const alt = s.oneOf?.[0] ?? s.anyOf?.[0];
  if (alt) return normalizeSchema(doc, { ...s, oneOf: undefined, anyOf: undefined, ...deref(doc, alt) }, depth + 1);
  return s;
}

export function schemaType(s: Schema | undefined): string {
  if (!s) return 'any';
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (t) return t;
  if (s.properties) return 'object';
  if (s.items) return 'array';
  return 'any';
}

/** DTO name of a schema: the $ref name, or a title. For arrays: the item name. */
export function dtoName(doc: OpenApiDoc, schema: Schema | undefined): { name?: string; isArray: boolean } {
  if (!schema) return { isArray: false };
  if (schema.$ref) {
    const target = deref(doc, schema);
    if (schemaType(target) === 'array' && target.items) return { name: dtoName(doc, target.items).name, isArray: true };
    return { name: refName(schema.$ref), isArray: false };
  }
  if (schemaType(schema) === 'array' && schema.items) return { name: dtoName(doc, schema.items).name, isArray: true };
  return { name: schema.title, isArray: false };
}

export function schemaNames(doc: OpenApiDoc): string[] {
  return Object.keys(doc.components?.schemas ?? doc.definitions ?? {});
}

export function schemaByName(doc: OpenApiDoc, name: string): Schema | undefined {
  return doc.components?.schemas?.[name] ?? doc.definitions?.[name];
}

function pickContent(content: Obj | undefined): [string, Obj] | undefined {
  if (!content) return undefined;
  const keys = Object.keys(content);
  const key =
    keys.find((k) => k.startsWith('application/json')) ??
    keys.find((k) => k.includes('+json')) ??
    keys.find((k) => k.includes('json')) ??
    keys[0];
  return key ? [key, content[key] as Obj] : undefined;
}

function firstExample(media: Obj): unknown {
  if ('example' in media) return media.example;
  const examples = media.examples as Record<string, { value?: unknown }> | undefined;
  const first = examples && Object.values(examples)[0];
  return first?.value;
}

export function extractOperations(doc: OpenApiDoc): Operation[] {
  const ops: Operation[] = [];
  const isV2 = !!doc.swagger;
  for (const [path, rawItem] of Object.entries(doc.paths ?? {})) {
    const item = deref(doc, rawItem);
    const shared = ((item.parameters as unknown[]) ?? []).map((p) => deref(doc, p) as Obj);
    for (const method of HTTP_METHODS) {
      const op = item[method] as Obj | undefined;
      if (!op) continue;
      const own = ((op.parameters as unknown[]) ?? []).map((p) => deref(doc, p) as Obj);
      // operation-level parameters override path-level ones with the same name+location
      const allParams = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];

      let requestBody: RequestBodyInfo | undefined;
      const parameters: Parameter[] = [];
      for (const p of allParams) {
        if (p.in === 'body') {
          requestBody = { contentType: 'application/json', required: !!p.required, description: p.description as string, schema: p.schema as Schema };
          continue;
        }
        if (p.in === 'formData') continue; // not supported in this iteration
        parameters.push({
          name: p.name as string,
          in: p.in as ParamLocation,
          required: p.in === 'path' || !!p.required,
          description: p.description as string | undefined,
          // Swagger 2.0 puts type info directly on the parameter
          schema: (p.schema as Schema) ?? (isV2 ? ({ type: p.type, format: p.format, enum: p.enum, items: p.items } as Schema) : undefined),
        });
      }

      if (op.requestBody) {
        const rb = deref(doc, op.requestBody) as Obj;
        const picked = pickContent(rb.content as Obj);
        if (picked) {
          requestBody = {
            contentType: picked[0],
            required: !!rb.required,
            description: rb.description as string | undefined,
            schema: picked[1].schema as Schema,
            example: firstExample(picked[1]),
          };
        }
      }

      const responses: ResponseInfo[] = Object.entries((op.responses as Obj) ?? {}).map(([status, raw]) => {
        const r = deref(doc, raw) as Obj;
        const picked = pickContent(r.content as Obj);
        if (picked) {
          return { status, description: r.description as string, contentType: picked[0], schema: picked[1].schema as Schema, example: firstExample(picked[1]) };
        }
        const v2Example = (r.examples as Obj | undefined)?.['application/json'];
        return { status, description: r.description as string, schema: r.schema as Schema | undefined, example: v2Example };
      });

      ops.push({
        id: `${method.toUpperCase()} ${path}`,
        method,
        path,
        tag: ((op.tags as string[]) ?? [])[0] ?? 'default',
        summary: op.summary as string | undefined,
        description: op.description as string | undefined,
        operationId: op.operationId as string | undefined,
        deprecated: !!op.deprecated,
        parameters,
        requestBody,
        responses,
      });
    }
  }
  return ops;
}

/** Groups operations by tag, respecting the order of the top-level `tags` list. */
export function groupByTag(doc: OpenApiDoc, ops: Operation[]): [string, Operation[]][] {
  const groups = new Map<string, Operation[]>();
  for (const t of doc.tags ?? []) groups.set(t.name, []);
  for (const op of ops) {
    if (!groups.has(op.tag)) groups.set(op.tag, []);
    groups.get(op.tag)!.push(op);
  }
  return [...groups].filter(([, list]) => list.length > 0);
}

export function baseUrl(doc: OpenApiDoc, specUrl: string): string {
  const origin = (() => {
    try {
      return new URL(specUrl, window.location.href);
    } catch {
      return new URL(window.location.href);
    }
  })();
  if (doc.servers?.length) return new URL(doc.servers[0].url, origin).toString().replace(/\/$/, '');
  if (doc.swagger) {
    const scheme = doc.schemes?.[0] ?? origin.protocol.replace(':', '');
    const host = doc.host ?? origin.host;
    return `${scheme}://${host}${doc.basePath ?? ''}`.replace(/\/$/, '');
  }
  return origin.origin;
}

/** Finds the documented response for a concrete status code (exact, then 2XX, then default). */
export function responseFor(op: Operation, status: number): ResponseInfo | undefined {
  return (
    op.responses.find((r) => r.status === String(status)) ??
    op.responses.find((r) => r.status.toUpperCase() === `${String(status)[0]}XX`) ??
    op.responses.find((r) => r.status === 'default')
  );
}
