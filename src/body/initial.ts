import { requestExampleFor } from '../openapi/example';
import { flattenFields } from '../openapi/fields';
import type { OpenApiDoc, Operation } from '../openapi/spec';
import { disablePaths, fromValue, type BodyNode } from './tree';

/** Example body for an operation; readOnly fields (ids, timestamps, …) start unchecked. */
export function initialBody(doc: OpenApiDoc, op: Operation): BodyNode | undefined {
  if (!op.requestBody) return undefined;
  const example = op.requestBody.example ?? requestExampleFor(doc, op.requestBody.schema);
  const readOnly = flattenFields(doc, op.requestBody.schema)
    .filter((f) => f.readOnly)
    .map((f) => f.path);
  return disablePaths(fromValue(example), readOnly);
}
