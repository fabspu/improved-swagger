import { useState } from 'react';
import { clearCaptured, objectLabel, removeCaptured, useStore, type CapturedObject } from '../store';
import { JsonView } from './common';

/** Right-hand column: the objects cached from responses, grouped by DTO. */
export function CapturePanel() {
  const captured = useStore((s) => s.captured);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  const groups = new Map<string, CapturedObject[]>();
  for (const c of captured) groups.set(c.dto, [...(groups.get(c.dto) ?? []), c]);

  if (collapsed) {
    return (
      <aside className="capture collapsed">
        <button className="ghost" onClick={() => setCollapsed(false)} title="Show cached objects">
          ◂ <span className="vertical">Cache ({captured.length})</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="capture">
      <div className="capture-head">
        <h3>Cached objects</h3>
        {captured.length > 0 && (
          <button className="ghost small" onClick={() => clearCaptured()}>
            Clear
          </button>
        )}
        <button className="ghost small" onClick={() => setCollapsed(true)} title="Hide">
          ▸
        </button>
      </div>
      {captured.length === 0 && <p className="muted small pad">Objects returned by successful requests appear here and can be mapped into request bodies.</p>}
      {[...groups].map(([dto, list]) => (
        <section key={dto} className="capture-group">
          <div className="capture-group-head">
            <span className="dto-name">{dto}</span>
            <span className="muted small">{list.length}</span>
            <button className="ghost tiny" onClick={() => clearCaptured(dto)} title={`Remove all ${dto}`}>
              ✕
            </button>
          </div>
          {list.map((c) => (
            <div key={c.id} className="capture-item">
              <button className="capture-label" onClick={() => setExpanded((e) => (e === c.id ? undefined : c.id))} title={c.source}>
                {objectLabel(c)}
              </button>
              <button className="ghost tiny" onClick={() => removeCaptured(c.id)} title="Remove">
                ✕
              </button>
              {expanded === c.id && <JsonView value={c.data} />}
            </div>
          ))}
        </section>
      ))}
    </aside>
  );
}
