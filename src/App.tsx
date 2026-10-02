import { useEffect, useMemo } from 'react';
import { CapturePanel } from './components/CapturePanel';
import { EndpointView } from './components/EndpointView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { loadActiveSpec } from './apis';
import { AddApiForm } from './components/ApiDialogs';
import { extractOperations } from './openapi/spec';
import { useStore } from './store';

export function App() {
  const doc = useStore((s) => s.doc);
  const specError = useStore((s) => s.specError);
  const selectedOpId = useStore((s) => s.selectedOpId);
  const loading = useStore((s) => s.specLoading);
  const hasApis = useStore((s) => s.apis.length > 0);
  const ops = useMemo(() => (doc ? extractOperations(doc) : []), [doc]);
  const selected = ops.find((o) => o.id === selectedOpId);

  useEffect(() => {
    void loadActiveSpec();
  }, []);

  if (!hasApis) {
    return (
      <div className="app">
        <TopBar />
        <div className="welcome">
          <h2>Add your first API</h2>
          <p className="muted">Paste the URL of its openapi.json / swagger.json. It is saved here, so you only do this once per API.</p>
          <AddApiForm onDone={() => undefined} showDemo />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      {specError && <div className="banner error">{specError}</div>}
      <div className="layout">
        <Sidebar ops={ops} />
        <main className="main">
          {doc && selected ? (
            <EndpointView key={selected.id} doc={doc} op={selected} />
          ) : (
            <div className="empty">
              <h2>{doc?.info?.title ?? (loading ? 'Loading spec…' : 'No spec loaded')}</h2>
              {doc && (
                <p>
                  Select an endpoint on the left. Press <kbd>/</kbd> to search.
                </p>
              )}
            </div>
          )}
        </main>
        <CapturePanel />
      </div>
    </div>
  );
}
