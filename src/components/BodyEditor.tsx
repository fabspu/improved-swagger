import { useMemo, useState, type ReactNode } from 'react';
import { initialBody } from '../body/initial';
import { fromValue, mergeDisabled, setEnabled, setValueAtDotPath, toValue, updateAt, type BodyNode, type NodePath } from '../body/tree';
import { applyMapping, fieldCandidates, isFieldMapped, objectCandidates, pathParamValues } from '../mapping';
import { flattenFields, type FieldInfo } from '../openapi/fields';
import type { OpenApiDoc, Operation } from '../openapi/spec';
import { targetDtoOf } from '../request';
import { objectLabel, updateDraft, useStore, type CapturedObject, type Mapping } from '../store';
import { HoverMenu, preview } from './common';
import { MappingDialog } from './MappingDialog';

interface Props {
  doc: OpenApiDoc;
  op: Operation;
}

export function BodyEditor({ doc, op }: Props) {
  const draftBody = useStore((s) => s.drafts[op.id]?.body);
  const mappings = useStore((s) => s.mappings);
  const captured = useStore((s) => s.captured);
  const fallback = useMemo(() => initialBody(doc, op), [doc, op]);
  const body = draftBody ?? fallback;
  const [raw, setRaw] = useState<string | undefined>(undefined);
  const [rawError, setRawError] = useState<string>();
  const [mappingOpen, setMappingOpen] = useState(false);

  const targetDto = targetDtoOf(doc, op);
  const fields = useMemo(() => new Map(flattenFields(doc, op.requestBody?.schema).map((f) => [f.path, f])), [doc, op]);
  const targetMappings = mappings.filter((m) => m.targetDto === targetDto);
  const wholeCandidates = objectCandidates(mappings, captured, targetDto);

  if (!body || !op.requestBody) return null;
  const setBody = (fn: (b: BodyNode) => BodyNode) => updateDraft(op.id, (d) => ({ ...d, body: fn(d.body ?? body) }));

  const switchToTree = () => {
    try {
      const parsed = fromValue(JSON.parse(raw ?? 'null'));
      setBody((prev) => mergeDisabled(prev, parsed));
      setRaw(undefined);
      setRawError(undefined);
    } catch (e) {
      setRawError(String(e));
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h3>
          Request body <span className="dto-name">{targetDto}</span>
          <span className="muted small"> {op.requestBody.contentType}</span>
          {op.requestBody.required && <span className="badge">required</span>}
        </h3>
        <div className="toolbar">
          <button className="ghost small" onClick={() => setMappingOpen(true)} title="Map fields of a response DTO onto this request DTO">
            ⇄ Map fields{targetMappings.length > 0 && <span className="count">{targetMappings.length}</span>}
          </button>
          {raw === undefined ? (
            <button className="ghost small" onClick={() => setRaw(JSON.stringify(toValue(body), null, 2))}>
              Raw
            </button>
          ) : (
            <button className="ghost small" onClick={switchToTree}>
              Tree
            </button>
          )}
          <button className="ghost small" onClick={() => updateDraft(op.id, (d) => ({ ...d, body: undefined }))} title="Reset to the example">
            Reset
          </button>
          <HoverMenu label="⤓ Fill from DTO" title="Apply all mapped fields from a cached object" className="primary-menu">
            {(close) =>
              wholeCandidates.length ? (
                wholeCandidates.map(({ obj, mapping }) => (
                  <button
                    key={`${mapping.sourceDto}-${obj.id}`}
                    className="menu-item"
                    onClick={() => {
                      setBody((b) => applyMapping(b, mapping, obj));
                      updateDraft(op.id, (d) => ({ ...d, params: { ...d.params, ...pathParamValues(op, obj) } }));
                      close();
                    }}
                  >
                    <span className="dto-name">{obj.dto}</span> {objectLabel(obj)}
                  </button>
                ))
              ) : (
                <p className="menu-hint">
                  {targetMappings.length
                    ? `No cached ${targetMappings.map((m) => m.sourceDto).join(' / ')} yet – run a GET that returns it.`
                    : 'No mapping yet – use “⇄ Map fields” first.'}
                </p>
              )
            }
          </HoverMenu>
        </div>
      </div>
      {op.requestBody.description && <p className="muted">{op.requestBody.description}</p>}

      {raw !== undefined ? (
        <>
          <textarea className="raw-editor" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} rows={16} />
          {rawError && <div className="banner error">{rawError}</div>}
        </>
      ) : (
        <div className="body-tree">
          <NodeRows
            node={body}
            path={[]}
            depth={0}
            ctx={{ fields, targetDto, mappings, captured, setBody, op }}
            entry={undefined}
            last
          />
        </div>
      )}

      {mappingOpen && <MappingDialog doc={doc} op={op} targetDto={targetDto} onClose={() => setMappingOpen(false)} />}
    </section>
  );
}

interface Ctx {
  fields: Map<string, FieldInfo>;
  targetDto: string;
  mappings: Mapping[];
  captured: CapturedObject[];
  setBody: (fn: (b: BodyNode) => BodyNode) => void;
  op: Operation;
}

interface Entry {
  label: string | number;
  enabled: boolean;
  parentOff: boolean;
  removable?: boolean;
}

/** Renders a node as JSON-looking rows: [checkbox] [code] [mapping action]. */
function NodeRows({ node, path, depth, ctx, entry, last }: { node: BodyNode; path: NodePath; depth: number; ctx: Ctx; entry?: Entry; last: boolean }) {
  const off = !!entry && (!entry.enabled || entry.parentOff);
  const dotPath = path.every((p) => typeof p === 'string') && path.length ? path.join('.') : undefined;
  const info = dotPath ? ctx.fields.get(dotPath) : undefined;
  const comma = last ? '' : ',';

  const prefix = entry ? (
    typeof entry.label === 'string' ? (
      <>
        <span className="j-key" title={fieldTitle(info)}>
          "{entry.label}"
        </span>
        {info?.required && <span className="req">*</span>}
        {info?.readOnly && <span className="ro">ro</span>}
        <span className="punct">: </span>
      </>
    ) : null
  ) : null;

  const checkbox = entry ? (
    <input
      type="checkbox"
      checked={entry.enabled}
      onChange={(e) => ctx.setBody((b) => setEnabled(b, path, e.target.checked))}
      title={entry.enabled ? 'Exclude from request' : 'Include in request'}
    />
  ) : null;

  const action = dotPath && !info?.readOnly ? <FieldSource ctx={ctx} dotPath={dotPath} /> : null;
  const remove = entry?.removable ? (
    <button
      className="ghost tiny"
      title="Remove item"
      onClick={() =>
        ctx.setBody((b) =>
          updateAt(b, path.slice(0, -1), (n) => (n.kind === 'array' ? { ...n, items: n.items.filter((_, i) => i !== path[path.length - 1]) } : n)),
        )
      }
    >
      ✕
    </button>
  ) : null;

  if (node.kind === 'object' || node.kind === 'array') {
    const [open, close] = node.kind === 'object' ? ['{', '}'] : ['[', ']'];
    const children =
      node.kind === 'object'
        ? node.fields.map((f, i) => (
            <NodeRows
              key={f.key}
              node={f.node}
              path={[...path, f.key]}
              depth={depth + 1}
              ctx={ctx}
              entry={{ label: f.key, enabled: f.enabled, parentOff: off }}
              last={i === node.fields.length - 1}
            />
          ))
        : node.items.map((it, i) => (
            <NodeRows
              key={i}
              node={it.node}
              path={[...path, i]}
              depth={depth + 1}
              ctx={ctx}
              entry={{ label: i, enabled: it.enabled, parentOff: off, removable: true }}
              last={i === node.items.length - 1}
            />
          ));
    const addItem =
      node.kind === 'array' ? (
        <button
          className="ghost tiny"
          title="Add item (copy of the last one)"
          onClick={() =>
            ctx.setBody((b) =>
              updateAt(b, path, (n) =>
                n.kind === 'array'
                  ? { ...n, items: [...n.items, { enabled: true, node: n.items.at(-1)?.node ?? { kind: 'string', value: '' } }] }
                  : n,
              ),
            )
          }
        >
          + item
        </button>
      ) : null;
    return (
      <>
        <Row depth={depth} off={off} checkbox={checkbox} action={<>{remove}{action}</>}>
          {prefix}
          <span className="punct">{open}</span>
        </Row>
        {children}
        <Row depth={depth} off={off} action={addItem}>
          <span className="punct">
            {close}
            {comma}
          </span>
        </Row>
      </>
    );
  }

  return (
    <Row depth={depth} off={off} checkbox={checkbox} action={<>{remove}{action}</>}>
      {prefix}
      <ValueInput node={node} info={info} onChange={(n) => ctx.setBody((b) => updateAt(b, path, () => n))} />
      <span className="punct">{comma}</span>
    </Row>
  );
}

function Row({ depth, off, checkbox, action, children }: { depth: number; off: boolean; checkbox?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`tree-row ${off ? 'off' : ''}`}>
      <span className="cb">{checkbox}</span>
      <span className="code" style={{ paddingLeft: depth * 18 }}>
        {children}
      </span>
      <span className="act">{action}</span>
    </div>
  );
}

function ValueInput({ node, info, onChange }: { node: BodyNode; info?: FieldInfo; onChange: (n: BodyNode) => void }) {
  switch (node.kind) {
    case 'string':
      if (info?.enum?.length) {
        return (
          <select className="v-str" value={node.value} onChange={(e) => onChange({ kind: 'string', value: e.target.value })}>
            {info.enum.map((v) => (
              <option key={String(v)} value={String(v)}>
                "{String(v)}"
              </option>
            ))}
          </select>
        );
      }
      return (
        <span className="v-wrap">
          <span className="j-str">"</span>
          <input
            className="v-str"
            value={node.value}
            style={{ width: `${Math.max(1, node.value.length) + 0.5}ch` }}
            onChange={(e) => onChange({ kind: 'string', value: e.target.value })}
          />
          <span className="j-str">"</span>
        </span>
      );
    case 'number':
      return (
        <input
          className="v-num"
          value={node.value}
          style={{ width: `${Math.max(1, node.value.length) + 0.5}ch` }}
          onChange={(e) => onChange({ kind: 'number', value: e.target.value })}
        />
      );
    case 'boolean':
      return (
        <select className="v-lit" value={String(node.value)} onChange={(e) => onChange({ kind: 'boolean', value: e.target.value === 'true' })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case 'null':
      return (
        <span className="j-lit" title="Click to turn into a string" onClick={() => onChange({ kind: 'string', value: '' })} role="button">
          null
        </span>
      );
    default:
      return null;
  }
}

/** The per-field button right of the JSON: hover to pick a cached object whose mapped field value is applied. */
function FieldSource({ ctx, dotPath }: { ctx: Ctx; dotPath: string }) {
  const mapping = isFieldMapped(ctx.mappings, ctx.targetDto, dotPath);
  if (!mapping) return null;
  const candidates = fieldCandidates(ctx.mappings, ctx.captured, ctx.targetDto, dotPath);
  return (
    <HoverMenu label="⇠" title={`Take value from ${mapping.sourceDto}.${mapping.fields[dotPath]}`} className={candidates.length ? 'has-items' : 'no-items'}>
      {(close) =>
        candidates.length ? (
          candidates.map((c) => (
            <button
              key={c.obj.id}
              className="menu-item"
              onClick={() => {
                ctx.setBody((b) => setValueAtDotPath(b, dotPath, c.value));
                close();
              }}
            >
              <span className="dto-name">{c.obj.dto}</span>
              <span className="muted small">{c.sourcePath}:</span> <span className="mono">{preview(c.value)}</span>
              {c.obj.data.id !== undefined && <span className="muted small menu-id">#{String(c.obj.data.id)}</span>}
            </button>
          ))
        ) : (
          <p className="menu-hint">No cached {mapping.sourceDto} yet – run a GET that returns it.</p>
        )
      }
    </HoverMenu>
  );
}

function fieldTitle(info?: FieldInfo): string | undefined {
  if (!info) return undefined;
  return [
    info.type + (info.format ? ` (${info.format})` : ''),
    info.required && 'required',
    info.readOnly && 'readOnly',
    info.enum && `one of ${info.enum.join(', ')}`,
    info.description,
  ]
    .filter(Boolean)
    .join(' · ');
}
