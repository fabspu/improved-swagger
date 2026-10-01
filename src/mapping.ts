import { setValueAtDotPath, type BodyNode } from './body/tree';
import { getAtPath } from './openapi/fields';
import type { Operation } from './openapi/spec';
import type { CapturedObject, Mapping } from './store';

export interface FieldCandidate {
  obj: CapturedObject;
  sourcePath: string;
  value: unknown;
}

/** Captured objects that can provide a value for one target field, via any mapping onto the target DTO. */
export function fieldCandidates(mappings: Mapping[], captured: CapturedObject[], targetDto: string, targetPath: string): FieldCandidate[] {
  return mappings
    .filter((m) => m.targetDto === targetDto && m.fields[targetPath])
    .flatMap((m) =>
      captured
        .filter((c) => c.dto === m.sourceDto)
        .map((obj) => ({ obj, sourcePath: m.fields[targetPath], value: getAtPath(obj.data, m.fields[targetPath]) })),
    )
    .filter((c) => c.value !== undefined);
}

export function isFieldMapped(mappings: Mapping[], targetDto: string, targetPath: string): Mapping | undefined {
  return mappings.find((m) => m.targetDto === targetDto && m.fields[targetPath]);
}

/** Captured objects that can fill the whole target DTO. */
export function objectCandidates(mappings: Mapping[], captured: CapturedObject[], targetDto: string): { obj: CapturedObject; mapping: Mapping }[] {
  return mappings
    .filter((m) => m.targetDto === targetDto)
    .flatMap((mapping) => captured.filter((c) => c.dto === mapping.sourceDto).map((obj) => ({ obj, mapping })));
}

/** Applies every mapped field of `obj` onto the body. */
export function applyMapping(body: BodyNode, mapping: Mapping, obj: CapturedObject): BodyNode {
  let out = body;
  for (const [targetPath, sourcePath] of Object.entries(mapping.fields)) {
    const value = getAtPath(obj.data, sourcePath);
    if (value !== undefined) out = setValueAtDotPath(out, targetPath, value);
  }
  return out;
}

/**
 * Path parameters that can be taken from a captured object: same name (`id`),
 * or `<dto>Id` for a DTO named `<Dto>Dto` (e.g. `productId` from ProductDto.id).
 */
export function pathParamValues(op: Operation, obj: CapturedObject): Record<string, string> {
  const base = obj.dto.replace(/(Dto|DTO|Response|Model|Resource)$/, '').toLowerCase();
  const out: Record<string, string> = {};
  for (const p of op.parameters.filter((p) => p.in === 'path')) {
    const value = p.name in obj.data ? obj.data[p.name] : p.name.toLowerCase() === `${base}id` ? obj.data.id : undefined;
    if (value !== undefined && value !== null && typeof value !== 'object') out[`path:${p.name}`] = String(value);
  }
  return out;
}
