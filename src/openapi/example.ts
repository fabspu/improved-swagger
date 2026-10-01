import { deref, normalizeSchema, schemaType, type OpenApiDoc, type Schema } from './spec';

/** Builds an example value for a schema. Read-only fields are included; the body editor unchecks them. */
export function exampleFor(doc: OpenApiDoc, schema: Schema | undefined, seen: string[] = []): unknown {
  if (!schema) return null;
  if (schema.$ref) {
    if (seen.includes(schema.$ref) || seen.length > 8) return schemaType(deref(doc, schema)) === 'array' ? [] : {};
    seen = [...seen, schema.$ref];
  }
  const s = normalizeSchema(doc, schema)!;
  if (s.example !== undefined) return s.example;
  if (s.examples?.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];

  switch (schemaType(s)) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(s.properties ?? {})) {
        if (deref(doc, prop).writeOnly) continue;
        out[key] = exampleFor(doc, prop, seen);
      }
      if (!s.properties && typeof s.additionalProperties === 'object') {
        out.additionalProp1 = exampleFor(doc, s.additionalProperties, seen);
      }
      return out;
    }
    case 'array':
      return [exampleFor(doc, s.items, seen)];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      return stringExample(s.format);
    default:
      return null;
  }
}

/** Request examples include writeOnly fields (e.g. passwords). */
export function requestExampleFor(doc: OpenApiDoc, schema: Schema | undefined, seen: string[] = []): unknown {
  if (!schema) return null;
  if (schema.$ref) {
    if (seen.includes(schema.$ref) || seen.length > 8) return {};
    seen = [...seen, schema.$ref];
  }
  const s = normalizeSchema(doc, schema)!;
  if (schemaType(s) === 'object' && s.example === undefined && s.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(s.properties)) out[key] = requestExampleFor(doc, prop, seen);
    return out;
  }
  if (schemaType(s) === 'array' && s.example === undefined && s.items) return [requestExampleFor(doc, s.items, seen)];
  return exampleFor(doc, s, seen);
}

function stringExample(format?: string): string {
  switch (format) {
    case 'date-time':
      return new Date().toISOString();
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'uuid':
      return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    case 'email':
      return 'user@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com';
    default:
      return 'string';
  }
}
