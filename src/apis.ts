import { normalizeSpecUrl, type OpenApiDoc } from './openapi/spec';
import {
  deleteApiStorage,
  emptyData,
  getActiveApi,
  getState,
  loadApiData,
  setState,
  specKey,
  type ApiEntry,
} from './store';

const UPLOAD_PREFIX = 'upload:';

/** Uploaded spec files, kept in memory as well in case they are too big for localStorage. */
const uploads = new Map<string, string>();

function message(e: unknown): string {
  if (e instanceof TypeError && /fetch/i.test(e.message)) {
    return `${e.message} – is the API running? (For other origins keep the proxy enabled in the API settings.)`;
  }
  return e instanceof Error ? e.message : String(e);
}

function parseSpec(json: unknown): OpenApiDoc {
  const doc = json as OpenApiDoc;
  if (!doc || typeof doc !== 'object' || !doc.paths || !(doc.openapi || doc.swagger)) {
    throw new Error('This does not look like an OpenAPI / Swagger JSON document.');
  }
  return doc;
}

/** Loads the spec of an API. Specs on other origins go through the dev-server proxy, so no CORS setup is needed. */
export async function fetchSpec(api: ApiEntry): Promise<OpenApiDoc> {
  if (api.specUrl.startsWith(UPLOAD_PREFIX)) {
    let text = uploads.get(api.id);
    try {
      text ??= localStorage.getItem(specKey(api.id)) ?? undefined;
    } catch {
      // storage unavailable
    }
    if (!text) throw new Error('The uploaded file is no longer stored – upload it again.');
    return parseSpec(JSON.parse(text));
  }

  const url = new URL(api.specUrl, location.href);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (api.bearerToken.trim()) headers.Authorization = `Bearer ${api.bearerToken.trim()}`;
  const viaProxy = getState().useProxy && url.origin !== location.origin;
  const res = await fetch(viaProxy ? '/__proxy' : url, {
    headers: viaProxy ? { ...headers, 'x-proxy-target': url.toString() } : headers,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text).title ?? '';
    } catch {
      // not a problem document
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` – ${detail}` : ''}`.trim());
  }
  try {
    return parseSpec(JSON.parse(text));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('The response is not JSON – is this the URL of the openapi.json / swagger.json (not the Swagger UI page)?');
    }
    throw e;
  }
}

let loadSeq = 0;

/** (Re)loads the spec of the active API. A newer call supersedes an older one still in flight. */
export async function loadActiveSpec(): Promise<void> {
  const api = getActiveApi();
  const seq = ++loadSeq;
  if (!api) {
    setState({ doc: undefined, specError: undefined, specLoading: false });
    return;
  }
  setState({ specLoading: true, specError: undefined });
  try {
    const doc = await fetchSpec(api);
    if (seq === loadSeq) setState({ doc, specLoading: false });
  } catch (e) {
    // an older doc (when refreshing) stays visible
    if (seq === loadSeq) setState({ specLoading: false, specError: `Could not load “${api.name}” (${api.specUrl}): ${message(e)}` });
  }
}

export interface NewApi {
  /** Pasted URL; ignored when `file` is set. */
  specUrl: string;
  file?: { name: string; text: string };
  name?: string;
  bearerToken?: string;
}

/** Registers an API after its spec loaded successfully. Returns an error message, or undefined on success. */
export async function addApi(input: NewApi): Promise<string | undefined> {
  const specUrl = input.file ? `${UPLOAD_PREFIX}${input.file.name}` : normalizeSpecUrl(input.specUrl);
  const existing = getState().apis.find((a) => a.specUrl === specUrl && !input.file);
  if (existing) {
    switchApi(existing.id);
    return undefined;
  }

  const api: ApiEntry = { id: crypto.randomUUID(), name: '', specUrl, baseUrl: '', bearerToken: input.bearerToken?.trim() ?? '' };
  if (input.file) {
    uploads.set(api.id, input.file.text);
    try {
      localStorage.setItem(specKey(api.id), input.file.text);
    } catch {
      // too big for localStorage: usable until the next reload
    }
  }

  let doc: OpenApiDoc;
  try {
    doc = await fetchSpec(api);
  } catch (e) {
    uploads.delete(api.id);
    deleteApiStorage(api.id);
    return message(e);
  }

  const host = new URL(specUrl.startsWith(UPLOAD_PREFIX) ? location.href : specUrl, location.href).host;
  api.name = input.name?.trim() || doc.info?.title || host;
  // two backends can share a title (dev/staging): keep the dropdown unambiguous
  if (getState().apis.some((a) => a.name === api.name)) api.name = `${api.name} (${host})`;
  loadSeq++;
  setState((s) => ({
    apis: [...s.apis, api],
    activeApiId: api.id,
    doc,
    specError: undefined,
    specLoading: false,
    results: {},
    ...emptyData(),
  }));
  return undefined;
}

export function switchApi(id: string): void {
  if (id === getState().activeApiId) return;
  setState({ activeApiId: id, doc: undefined, specError: undefined, results: {}, ...loadApiData(id) });
  void loadActiveSpec();
}

export function updateApi(id: string, patch: Partial<Omit<ApiEntry, 'id'>>): void {
  setState((s) => ({ apis: s.apis.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
}

export function removeApi(id: string): void {
  const { apis, activeApiId } = getState();
  const rest = apis.filter((a) => a.id !== id);
  const wasActive = activeApiId === id;
  const next = wasActive ? rest[0]?.id : activeApiId;
  uploads.delete(id);
  setState({
    apis: rest,
    activeApiId: next,
    ...(wasActive ? { doc: undefined, specError: undefined, results: {}, ...(next ? loadApiData(next) : emptyData()) } : {}),
  });
  deleteApiStorage(id);
  if (wasActive) void loadActiveSpec();
}
