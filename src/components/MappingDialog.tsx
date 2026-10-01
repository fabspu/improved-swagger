import { useMemo, useState } from 'react';
import { autoMatch, flattenFields, flattenValue, getAtPath, type FieldInfo } from '../openapi/fields';
import { schemaByName, schemaNames, type OpenApiDoc, type Operation } from '../openapi/spec';
import { deleteMapping, saveMapping, useStore } from '../store';
import { Modal, preview } from './common';

interface Props {
  doc: OpenApiDoc;
  op: Operation;
  targetDto: string;
  onClose: () => void;
}

/** Step 1: pick the source DTO (searchable). Step 2: map its fields onto the request DTO. */
export function MappingDialog({ doc, op, targetDto, onClose }: Props) {
  const [source, setSource] = useState<string>();
  return source ? (
    <FieldMapper doc={doc} op={op} source={source} targetDto={targetDto} onBack={() => setSource(undefined)} onClose={onClose} />
  ) : (
    <DtoPicker doc={doc} targetDto={targetDto} onPick={setSource} onClose={onClose} />
  );
}

function DtoPicker({ doc, targetDto, onPick, onClose }: { doc: OpenApiDoc; targetDto: string; onPick: (dto: string) => void; onClose: () => void }) {
  const captured = useStore((s) => s.captured);
  const mappings = useStore((s) => s.mappings);
  const [query, setQuery] = useState('');

  const entries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of captured) counts.set(c.dto, (counts.get(c.dto) ?? 0) + 1);
    const names = [...new Set([...schemaNames(doc), ...counts.keys()])];
    const mapped = new Set(mappings.filter((m) => m.targetDto === targetDto).map((m) => m.sourceDto));
    const q = query.toLowerCase();
    return names
      .filter((n) => n.toLowerCase().includes(q))
      .map((name) => ({ name, count: counts.get(name) ?? 0, mapped: mapped.has(name) }))
      .sort((a, b) => Number(b.mapped) - Number(a.mapped) || b.count - a.count || a.name.localeCompare(b.name));
  }, [doc, captured, mappings, targetDto, query]);

  return (
    <Modal title={<>Map onto <span className="dto-name">{targetDto}</span> – choose source DTO</>} onClose={onClose}>
      <input
        className="search"
        autoFocus
        placeholder="Search DTOs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && entries[0] && onPick(entries[0].name)}
      />
      <div className="dto-list">
        {entries.map((e) => (
          <button key={e.name} className="dto-item" onClick={() => onPick(e.name)}>
            <span className="dto-name">{e.name}</span>
            {e.mapped && <span className="badge ok">mapped</span>}
            <span className="muted small">{e.count ? `${e.count} cached` : 'nothing cached'}</span>
          </button>
        ))}
        {entries.length === 0 && <p className="muted">No DTO matches.</p>}
      </div>
    </Modal>
  );
}

function FieldMapper({
  doc,
  op,
  source,
  targetDto,
  onBack,
  onClose,
}: {
  doc: OpenApiDoc;
  op: Operation;
  source: string;
  targetDto: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const existing = useStore((s) => s.mappings.find((m) => m.sourceDto === source && m.targetDto === targetDto));
  const sample = useStore((s) => s.captured.find((c) => c.dto === source));

  const targetFields = useMemo(() => flattenFields(doc, op.requestBody?.schema).filter((f) => !f.readOnly), [doc, op]);
  const sourceFields = useMemo<FieldInfo[]>(() => {
    const schema = schemaByName(doc, source);
    return schema ? flattenFields(doc, schema) : flattenValue(sample?.data);
  }, [doc, source, sample]);

  const [fields, setFields] = useState<Record<string, string>>(() => existing?.fields ?? autoMatch(targetFields, sourceFields));
  const set = (target: string, src: string) =>
    setFields((f) => {
      const next = { ...f };
      if (src) next[target] = src;
      else delete next[target];
      return next;
    });

  const mappedCount = Object.keys(fields).length;

  return (
    <Modal
      title={
        <>
          <span className="dto-name">{source}</span> → <span className="dto-name">{targetDto}</span>
        </>
      }
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="danger ghost"
              onClick={() => {
                deleteMapping(source, targetDto);
                onClose();
              }}
            >
              Remove mapping
            </button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onBack}>
            ← Other DTO
          </button>
          <button
            className="primary"
            disabled={mappedCount === 0}
            onClick={() => {
              saveMapping({ sourceDto: source, targetDto, fields });
              onClose();
            }}
          >
            Apply ({mappedCount} fields)
          </button>
        </>
      }
    >
      <div className="mapper-tools">
        <span className="muted small">
          Writable fields of {targetDto}. Leave a field on “—” to never overwrite it.
          {sample ? ' Preview values come from the first cached object.' : ''}
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => setFields((f) => ({ ...autoMatch(targetFields, sourceFields), ...f }))}>
          Auto-match by name
        </button>
        <button className="ghost small" onClick={() => setFields({})}>
          Clear
        </button>
      </div>
      <table className="mapper">
        <thead>
          <tr>
            <th>{targetDto} field</th>
            <th />
            <th>{source} field</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          {targetFields.map((t) => {
            const src = fields[t.path] ?? '';
            const srcInfo = sourceFields.find((s) => s.path === src);
            const mismatch = srcInfo && !typesCompatible(t.type, srcInfo.type);
            return (
              <tr key={t.path} className={src ? 'mapped' : ''}>
                <td style={{ paddingLeft: 8 + (t.path.split('.').length - 1) * 16 }}>
                  <span className="mono">{t.path.split('.').pop()}</span>
                  {t.required && <span className="req">*</span>} <span className="muted small">{t.type}</span>
                </td>
                <td className="arrow">←</td>
                <td>
                  <select value={src} onChange={(e) => set(t.path, e.target.value)}>
                    <option value="">—</option>
                    {sourceFields.map((s) => (
                      <option key={s.path} value={s.path}>
                        {s.path} ({s.type})
                      </option>
                    ))}
                  </select>
                  {mismatch && (
                    <span className="warn" title={`Type mismatch: ${srcInfo.type} → ${t.type}`}>
                      ⚠
                    </span>
                  )}
                </td>
                <td className="mono small muted">{src && sample ? preview(getAtPath(sample.data, src), 28) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {targetFields.length === 0 && <p className="muted">The request body has no writable object fields to map.</p>}
    </Modal>
  );
}

function typesCompatible(target: string, source: string): boolean {
  if (target === 'any' || source === 'any' || source === 'null') return true;
  const num = (t: string) => (t === 'integer' ? 'number' : t);
  return num(target) === num(source) || (target.endsWith('[]') && source === 'array') || (source.endsWith('[]') && target === 'array');
}
