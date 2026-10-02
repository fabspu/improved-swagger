import { useState, type FormEvent } from 'react';
import { addApi, loadActiveSpec, removeApi, updateApi } from '../apis';
import { baseUrl, normalizeSpecUrl } from '../openapi/spec';
import { setState, useStore } from '../store';
import { Modal } from './common';

/** Paste a spec URL (or pick a file) and register the API once its spec loaded. */
export function AddApiForm({ onDone, showDemo }: { onDone: () => void; showDemo?: boolean }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [file, setFile] = useState<{ name: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file && !url.trim()) return;
    setBusy(true);
    setError(undefined);
    const err = await addApi({ specUrl: url, file, name, bearerToken: token });
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <form className="add-api" onSubmit={submit}>
      <div className="add-api-row">
        <input
          autoFocus
          value={file ? `📄 ${file.name}` : url}
          disabled={!!file}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste the URL of the openapi.json, e.g. localhost:8080/v3/api-docs"
          spellCheck={false}
        />
        <button className="primary" type="submit" disabled={busy || (!file && !url.trim())}>
          {busy ? 'Loading…' : 'Add'}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="add-api-extras">
        {file ? (
          <button type="button" className="ghost small" onClick={() => setFile(undefined)}>
            ✕ Remove file
          </button>
        ) : (
          <label className="button ghost small">
            …or upload a file
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setFile({ name: f.name, text: await f.text() });
              }}
            />
          </label>
        )}
        {showDemo && !file && (
          <button type="button" className="ghost small" onClick={() => setUrl('/mock-api/openapi.json')}>
            Use the demo API
          </button>
        )}
      </div>
      <details>
        <summary className="muted small">Optional: name and token</summary>
        <div className="add-api-optional">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (default: title from the spec)" />
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token (also used to load the spec)" />
        </div>
      </details>
    </form>
  );
}

export function AddApiDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Add API" onClose={onClose}>
      <AddApiForm onDone={onClose} />
    </Modal>
  );
}

export function ApiSettingsDialog({ onClose }: { onClose: () => void }) {
  const api = useStore((s) => s.apis.find((a) => a.id === s.activeApiId));
  const doc = useStore((s) => s.doc);
  const useProxy = useStore((s) => s.useProxy);
  const [form, setForm] = useState(() => ({
    name: api?.name ?? '',
    specUrl: api?.specUrl ?? '',
    baseUrl: api?.baseUrl ?? '',
    bearerToken: api?.bearerToken ?? '',
  }));
  if (!api) return null;
  const uploaded = api.specUrl.startsWith('upload:');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    const specUrl = uploaded ? api.specUrl : normalizeSpecUrl(form.specUrl);
    updateApi(api.id, { name: form.name.trim() || api.name, specUrl, baseUrl: form.baseUrl.trim(), bearerToken: form.bearerToken.trim() });
    if (specUrl !== api.specUrl || form.bearerToken.trim() !== api.bearerToken) void loadActiveSpec();
    onClose();
  };

  return (
    <Modal
      title={`API settings – ${api.name}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="danger ghost"
            onClick={() => {
              if (confirm(`Remove “${api.name}” including its cached objects, mappings and drafts?`)) {
                removeApi(api.id);
                onClose();
              }
            }}
          >
            Remove API
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          Name
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          Spec URL
          <input value={form.specUrl} disabled={uploaded} onChange={(e) => set({ specUrl: e.target.value })} spellCheck={false} />
          {uploaded && <span className="muted small">Uploaded file – remove and add the API again to replace it.</span>}
        </label>
        <label>
          Base URL
          <input
            value={form.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder={doc ? `${baseUrl(doc, api.specUrl)}  (from the spec)` : 'taken from the spec'}
            spellCheck={false}
          />
          <span className="muted small">Where requests are sent. Leave empty to use the spec's servers.</span>
        </label>
        <label>
          Bearer token
          <input value={form.bearerToken} onChange={(e) => set({ bearerToken: e.target.value })} placeholder="sent as Authorization header" />
        </label>
        <label className="row">
          <input type="checkbox" checked={useProxy} onChange={(e) => setState({ useProxy: e.target.checked })} />
          <span>
            Send requests to other origins through the dev-server proxy (avoids CORS, accepts local self-signed HTTPS certificates). Applies to all APIs.
          </span>
        </label>
      </div>
    </Modal>
  );
}
