import { describe, expect, it } from 'vitest';
import { spec } from '../mock/openapi';
import { initialBody } from './body/initial';
import { fromValue, mergeDisabled, setEnabled, setValueAtDotPath, toValue } from './body/tree';
import { applyMapping, fieldCandidates, pathParamValues } from './mapping';
import { autoMatch, flattenFields } from './openapi/fields';
import { extractOperations, schemaByName, type OpenApiDoc } from './openapi/spec';
import type { CapturedObject, Mapping } from './store';

const doc = spec as unknown as OpenApiDoc;
const ops = extractOperations(doc);
const op = (id: string) => ops.find((o) => o.id === id)!;

const product: CapturedObject = {
  id: 'c1',
  dto: 'ProductDto',
  source: 'GET /api/products',
  capturedAt: 0,
  data: { id: 7, name: 'Laptop', price: 10, stock: 3, dimensions: { width: 1, height: 2, depth: 3 }, createdAt: 'x' },
};

describe('body tree', () => {
  it('drops disabled fields and array items when serializing', () => {
    let node = fromValue({ id: 1, name: 'a', tags: ['x', 'y'] });
    node = setEnabled(node, ['id'], false);
    node = setEnabled(node, ['tags', 0], false);
    expect(toValue(node)).toEqual({ name: 'a', tags: ['y'] });
  });

  it('writes values at dot paths, re-enabling the field', () => {
    let node = setEnabled(fromValue({ a: { b: 1 } }), ['a'], false);
    node = setValueAtDotPath(node, 'a.b', 5);
    node = setValueAtDotPath(node, 'c.d', 'new');
    expect(toValue(node)).toEqual({ a: { b: 5 }, c: { d: 'new' } });
  });

  it('keeps disabled fields after raw editing', () => {
    const prev = setEnabled(fromValue({ id: 1, name: 'a' }), ['id'], false);
    const merged = mergeDisabled(prev, fromValue({ name: 'b' }));
    expect(toValue(merged)).toEqual({ name: 'b' });
    expect(merged.kind === 'object' && merged.fields.map((f) => f.key)).toEqual(['name', 'id']);
  });
});

describe('spec', () => {
  it('starts readOnly fields unchecked in the example body', () => {
    const body = toValue(initialBody(doc, op('POST /api/products'))!) as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
    expect(body.name).toBe('Laptop');
  });

  it('auto-matches fields by name', () => {
    const target = flattenFields(doc, op('PUT /api/products/{id}').requestBody!.schema).filter((f) => !f.readOnly);
    const source = flattenFields(doc, schemaByName(doc, 'ProductDto'));
    const m = autoMatch(target, source);
    expect(m.name).toBe('name');
    expect(m['dimensions.width']).toBe('dimensions.width');
    expect(m.dimensions).toBeUndefined(); // children win over the parent object
    expect(m.stockQuantity).toBeUndefined(); // different name: user maps it manually
  });
});

describe('mapping', () => {
  const mapping: Mapping = { sourceDto: 'ProductDto', targetDto: 'UpdateProductDto', fields: { name: 'name', stockQuantity: 'stock' } };

  it('applies a whole object', () => {
    const put = op('PUT /api/products/{id}');
    const body = applyMapping(initialBody(doc, put)!, mapping, product);
    expect(toValue(body)).toMatchObject({ name: 'Laptop', stockQuantity: 3 });
    expect(pathParamValues(put, product)).toEqual({ 'path:id': '7' });
  });

  it('lists per-field candidates', () => {
    const c = fieldCandidates([mapping], [product], 'UpdateProductDto', 'stockQuantity');
    expect(c.map((x) => x.value)).toEqual([3]);
  });
});
