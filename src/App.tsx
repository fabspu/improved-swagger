import { useEffect, useMemo } from 'react';
import { CapturePanel } from './components/CapturePanel';
import { EndpointView } from './components/EndpointView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { extractOperations, type OpenApiDoc } from './openapi/spec';
import { getState, setState, useStore } from './store';

const UPLOAD_KEY = 'improved-swagger:uploaded-spec';

export async function loadSpec(url: string): Promise<void> {
  setState({ specUrl: url, specError: undefined });
  try {
    if (url.startsWith('upload:')) {
      applySpec(JSON.parse(localStorage.getItem(UPLOAD_KEY) ?? 'null') ?? {}, url);
      return;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    applySpec(await res.json(), url);
  } catch (e) {
    setState({ specError: `Could not load ${url}: ${String(e)}` });
  }
}

/** Specs loaded from a file are kept in localStorage so a reload doesn't lose them. */
export function applyUploadedSpec(text: string, fileName: string): void {
  try {
    localStorage.setItem(UPLOAD_KEY, text);
  } catch {
    // too large for localStorage: works until the next reload
  }
  applySpec(JSON.parse(text), `upload:${fileName}`);
}

export function applySpec(doc: OpenApiDoc, specUrl: string): void {
  if (!doc.paths || !(doc.openapi || doc.swagger)) {
    setState({ specError: 'This does not look like an OpenAPI / Swagger JSON document.' });
    return;
  }
  setState({ doc, specUrl, specError: undefined });
}

export function App() {
  const doc = useStore((s) => s.doc);
  const specError = useStore((s) => s.specError);
  const selectedOpId = useStore((s) => s.selectedOpId);
  const ops = useMemo(() => (doc ? extractOperations(doc) : []), [doc]);
  const selected = ops.find((o) => o.id === selectedOpId);

  useEffect(() => {
    void loadSpec(getState().specUrl);
  }, []);

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
              <h2>{doc?.info?.title ?? 'No spec loaded'}</h2>
              <p>Select an endpoint on the left. Press <kbd>/</kbd> to search.</p>
            </div>
          )}
        </main>
        <CapturePanel />
      </div>
    </div>
  );
}
