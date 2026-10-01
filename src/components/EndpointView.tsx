import { useState } from 'react';
import { pathParamValues } from '../mapping';
import { exampleFor } from '../openapi/example';
import { flattenFields } from '../openapi/fields';
import { dtoName, normalizeSchema, schemaType, type OpenApiDoc, type Operation, type ResponseInfo, type Schema } from '../openapi/spec';
import { buildUrl, execute } from '../request';
import { objectLabel, updateDraft, useStore } from '../store';
import { BodyEditor } from './BodyEditor';
import { HoverMenu, JsonView, MethodBadge, StatusBadge } from './common';

export function EndpointView({ doc, op }: { doc: OpenApiDoc; op: Operation }) {
  const params = useStore((s) => s.drafts[op.id]?.params ?? EMPTY);
  const result = useStore((s) => s.results[op.id]);
  const [running, setRunning] = useState(false);
  const success = op.responses.filter((r) => /^[123]/.test(r.status));
  const errors = op.responses.filter((r) => !/^[123]/.test(r.status));

  const run = async () => {
    setRunning(true);
    await execute(doc, op);
    setRunning(false);
  };

  return (
    <div className="endpoint-view">
      <div className="endpoint-head">
        <MethodBadge method={op.method} />
        <h2 className="mono">{op.path}</h2>
        {op.deprecated && <span className="badge warn">deprecated</span>}
      </div>
      {op.summary && <p className="summary-line">{op.summary}</p>}
      {op.description && <p className="muted pre-line">{op.description}</p>}

      {op.parameters.length > 0 && <ParamsCard op={op} params={params} />}
      {op.requestBody && <BodyEditor doc={doc} op={op} />}

      <div className="execute-bar">
        <button className="primary big" onClick={run} disabled={running}>
          {running ? 'Sending…' : '▶ Execute'}
        </button>
        <code className="muted url-preview">
          {op.method.toUpperCase()} {buildUrl(doc, op, params)}
        </code>
      </div>

      {result && <ResultCard op={op} />}

      <section className="card">
        <div className="card-head">
          <h3>Responses</h3>
        </div>
        {success.map((r) => (
          <ResponseDoc key={r.status} doc={doc} response={r} />
        ))}
        {errors.length > 0 && <h4 className="subhead">Error types</h4>}
        {errors.map((r) => (
          <ResponseDoc key={r.status} doc={doc} response={r} />
        ))}
      </section>
    </div>
  );
}

const EMPTY: Record<string, string> = {};

function ParamsCard({ op, params }: { op: Operation; params: Record<string, string> }) {
  const captured = useStore((s) => s.captured);
  const setParam = (key: string, value: string) => updateDraft(op.id, (d) => ({ ...d, params: { ...d.params, [key]: value } }));

  return (
    <section className="card">
      <div className="card-head">
        <h3>Parameters</h3>
      </div>
      <div className="params">
        {op.parameters.map((p) => {
          const key = `${p.in}:${p.name}`;
          const candidates = p.in === 'path' ? captured.filter((c) => key in pathParamValues(op, c)) : [];
          const enumValues = p.schema?.enum;
          return (
            <div className="param" key={key}>
              <label className="param-name">
                <span className="mono">
                  {p.name}
                  {p.required && <span className="req">*</span>}
                </span>
                <span className="muted small">
                  {p.in} · {schemaType(p.schema)}
                </span>
              </label>
              {enumValues ? (
                <select value={params[key] ?? ''} onChange={(e) => setParam(key, e.target.value)}>
                  <option value="" />
                  {enumValues.map((v) => (
                    <option key={String(v)}>{String(v)}</option>
                  ))}
                </select>
              ) : (
                <input value={params[key] ?? ''} placeholder={p.description ?? p.name} onChange={(e) => setParam(key, e.target.value)} />
              )}
              <span className="act">
                {candidates.length > 0 && (
                  <HoverMenu label="⇠" title="Take value from a cached object">
                    {(close) =>
                      candidates.map((c) => (
                        <button
                          key={c.id}
                          className="menu-item"
                          onClick={() => {
                            setParam(key, pathParamValues(op, c)[key]);
                            close();
                          }}
                        >
                          <span className="dto-name">{c.dto}</span> {objectLabel(c)}
                        </button>
                      ))
                    }
                  </HoverMenu>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResultCard({ op }: { op: Operation }) {
  const result = useStore((s) => s.results[op.id])!;
  const [tab, setTab] = useState<'body' | 'headers'>('body');
  return (
    <section className="card result">
      <div className="card-head">
        <h3>
          Response {result.status ? <StatusBadge status={result.status} /> : <span className="badge danger">failed</span>}
          <span className="muted small">
            {' '}
            {result.statusText} · {result.durationMs} ms
          </span>
        </h3>
        <div className="toolbar">
          <button className={`ghost small ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>
            Body
          </button>
          <button className={`ghost small ${tab === 'headers' ? 'active' : ''}`} onClick={() => setTab('headers')}>
            Headers ({result.headers.length})
          </button>
        </div>
      </div>
      {result.captured && (
        <div className="banner ok">
          Cached {result.captured.count} × <span className="dto-name">{result.captured.dto}</span> – available for field mapping.
        </div>
      )}
      {result.error && <div className="banner error">{result.error}</div>}
      {tab === 'body' ? (
        result.json !== undefined ? (
          <JsonView value={result.json} />
        ) : (
          <pre className="json">{result.bodyText || <span className="muted">(empty body)</span>}</pre>
        )
      ) : (
        <table className="headers">
          <tbody>
            {result.headers.map(([k, v]) => (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ResponseDoc({ doc, response }: { doc: OpenApiDoc; response: ResponseInfo }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'example' | 'schema'>('example');
  const { name, isArray } = dtoName(doc, response.schema);
  return (
    <div className="response-doc">
      <button className="response-head" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▾' : '▸'}</span>
        <StatusBadge status={response.status} />
        <span>{response.description}</span>
        {name && (
          <span className="dto-name">
            {name}
            {isArray ? '[]' : ''}
          </span>
        )}
        {response.contentType && <span className="muted small">{response.contentType}</span>}
      </button>
      {open && response.schema && (
        <div className="response-body">
          <div className="toolbar">
            <button className={`ghost small ${tab === 'example' ? 'active' : ''}`} onClick={() => setTab('example')}>
              Example
            </button>
            <button className={`ghost small ${tab === 'schema' ? 'active' : ''}`} onClick={() => setTab('schema')}>
              Schema
            </button>
          </div>
          {tab === 'example' ? <JsonView value={response.example ?? exampleFor(doc, response.schema)} /> : <SchemaView doc={doc} schema={response.schema} />}
        </div>
      )}
      {open && !response.schema && <p className="muted small pad">No body.</p>}
    </div>
  );
}

function SchemaView({ doc, schema }: { doc: OpenApiDoc; schema: Schema }) {
  const s = normalizeSchema(doc, schema)!;
  const isArray = schemaType(s) === 'array';
  const fields = flattenFields(doc, isArray ? s.items : s);
  if (!fields.length) return <p className="mono small">{isArray ? `${schemaType(normalizeSchema(doc, s.items))}[]` : schemaType(s)}</p>;
  return (
    <table className="schema">
      <tbody>
        {isArray && (
          <tr>
            <td colSpan={3} className="muted small">
              Array of {dtoName(doc, s.items).name ?? 'objects'}
            </td>
          </tr>
        )}
        {fields.map((f) => (
          <tr key={f.path}>
            <td className="mono" style={{ paddingLeft: 8 + (f.path.split('.').length - 1) * 16 }}>
              {f.path.split('.').pop()}
              {f.required && <span className="req">*</span>}
            </td>
            <td className="mono small">
              {f.type}
              {f.format && <span className="muted">({f.format})</span>}
              {f.nullable && <span className="muted"> | null</span>}
            </td>
            <td className="small">
              {f.readOnly && <span className="badge">readOnly</span>}
              {f.enum && <span className="muted">{f.enum.map(String).join(' | ')} </span>}
              {f.description}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
