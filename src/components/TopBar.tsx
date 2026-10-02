import { useState } from 'react';
import { loadActiveSpec, switchApi } from '../apis';
import { useStore } from '../store';
import { AddApiDialog, ApiSettingsDialog } from './ApiDialogs';

export function TopBar() {
  const apis = useStore((s) => s.apis);
  const activeId = useStore((s) => s.activeApiId);
  const loading = useStore((s) => s.specLoading);
  const info = useStore((s) => s.doc?.info);
  const [dialog, setDialog] = useState<'add' | 'settings'>();

  return (
    <header className="topbar">
      <div className="brand">
        Improved<span>Swagger</span>
      </div>
      {apis.length > 0 && (
        <select className="api-select" value={activeId} onChange={(e) => switchApi(e.target.value)} aria-label="Active API">
          {apis.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <button className="small" onClick={() => setDialog('add')}>
        ＋ Add API
      </button>
      {activeId && (
        <button className="ghost small" onClick={() => void loadActiveSpec()} disabled={loading} title="Reload the spec">
          {loading ? '…' : '⟳'}
        </button>
      )}
      {info && (
        <span className="muted small" title={info.description}>
          v{info.version}
        </span>
      )}
      <span className="spacer" />
      {activeId && (
        <button className="ghost" onClick={() => setDialog('settings')}>
          ⚙ API settings
        </button>
      )}
      {dialog === 'add' && <AddApiDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'settings' && <ApiSettingsDialog onClose={() => setDialog(undefined)} />}
    </header>
  );
}
