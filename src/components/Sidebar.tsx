import { useEffect, useMemo, useRef, useState } from 'react';
import { groupByTag, type Operation } from '../openapi/spec';
import { setState, useStore } from '../store';
import { MethodBadge } from './common';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function Sidebar({ ops }: { ops: Operation[] }) {
  const doc = useStore((s) => s.doc);
  const selectedOpId = useStore((s) => s.selectedOpId);
  const [query, setQuery] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = useMemo(() => {
    if (!doc) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = ops.filter((op) => {
      if (methods.length && !methods.includes(op.method)) return false;
      const haystack = `${op.method} ${op.path} ${op.summary ?? ''} ${op.operationId ?? ''} ${op.tag}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
    return groupByTag(doc, filtered);
  }, [doc, ops, query, methods]);

  const toggleMethod = (m: string) => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          ref={searchRef}
          className="search"
          placeholder="Search endpoints…  ( / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        <div className="method-filter">
          {METHODS.map((m) => (
            <button key={m} className={`chip method-${m} ${methods.includes(m) ? 'active' : ''}`} onClick={() => toggleMethod(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <nav className="endpoint-list">
        {groups.map(([tag, list]) => {
          // while searching, all groups stay open
          const isCollapsed = !query && collapsed[tag];
          return (
            <section key={tag}>
              <button className="tag" onClick={() => setCollapsed((c) => ({ ...c, [tag]: !c[tag] }))}>
                <span>{isCollapsed ? '▸' : '▾'}</span> {tag} <span className="muted">{list.length}</span>
              </button>
              {!isCollapsed &&
                list.map((op) => (
                  <button
                    key={op.id}
                    className={`endpoint ${op.id === selectedOpId ? 'selected' : ''} ${op.deprecated ? 'deprecated' : ''}`}
                    onClick={() => setState({ selectedOpId: op.id })}
                    title={op.summary}
                  >
                    <MethodBadge method={op.method} />
                    <span className="endpoint-text">
                      <span className="path">{op.path}</span>
                      {op.summary && <span className="summary">{op.summary}</span>}
                    </span>
                  </button>
                ))}
            </section>
          );
        })}
        {doc && groups.length === 0 && <p className="muted pad">No endpoints match.</p>}
      </nav>
    </aside>
  );
}
