import { useEffect, useState } from 'react';
import { applyUploadedSpec, loadSpec } from '../App';
import { setState, useStore } from '../store';

export function TopBar() {
  const specUrl = useStore((s) => s.specUrl);
  const info = useStore((s) => s.doc?.info);
  const settings = useStore((s) => s.settings);
  const [url, setUrl] = useState(specUrl);
  useEffect(() => setUrl(specUrl), [specUrl]);
  const [showSettings, setShowSettings] = useState(false);

  const onFile = async (file: File) => {
    try {
      applyUploadedSpec(await file.text(), file.name);
      setUrl(`upload:${file.name}`);
    } catch (e) {
      setState({ specError: `Could not parse ${file.name}: ${String(e)}` });
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        Improved<span>Swagger</span>
      </div>
      <form
        className="spec-form"
        onSubmit={(e) => {
          e.preventDefault();
          void loadSpec(url);
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL to openapi.json / swagger.json" />
        <button type="submit">Load</button>
        <label className="button ghost">
          Upload…
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      </form>
      {info && (
        <div className="spec-title" title={info.description}>
          {info.title} <span className="muted">v{info.version}</span>
        </div>
      )}
      <div className="settings-anchor">
        <button className="ghost" onClick={() => setShowSettings((v) => !v)}>
          ⚙ Settings
        </button>
        {showSettings && (
          <div className="popover settings">
            <label>
              Base URL override
              <input
                value={settings.baseUrlOverride}
                placeholder="taken from the spec's servers"
                onChange={(e) => setState({ settings: { ...settings, baseUrlOverride: e.target.value } })}
              />
            </label>
            <label>
              Bearer token
              <input
                value={settings.bearerToken}
                placeholder="sent as Authorization header"
                onChange={(e) => setState({ settings: { ...settings, bearerToken: e.target.value } })}
              />
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={settings.useProxy}
                onChange={(e) => setState({ settings: { ...settings, useProxy: e.target.checked } })}
              />
              Route cross-origin requests through the dev-server proxy (avoids CORS)
            </label>
          </div>
        )}
      </div>
    </header>
  );
}
