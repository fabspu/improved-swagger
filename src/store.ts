import { useSyncExternalStore } from 'react';
import type { BodyNode } from './body/tree';
import type { OpenApiDoc } from './openapi/spec';

export interface CapturedObject {
  id: string;
  dto: string;
  data: Record<string, unknown>;
  /** Operation that produced it, e.g. "GET /api/products". */
  source: string;
  capturedAt: number;
}

/** Maps fields of a source DTO (from a response) onto fields of a target DTO (a request body). */
export interface Mapping {
  sourceDto: string;
  targetDto: string;
  /** target dot path -> source dot path */
  fields: Record<string, string>;
}

export interface OperationDraft {
  params: Record<string, string>;
  body?: BodyNode;
}

export interface ExecResult {
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  headers: [string, string][];
  bodyText: string;
  json?: unknown;
  captured?: { dto: string; count: number };
  error?: string;
}

/** A registered API: a spec URL plus the per-API connection settings. */
export interface ApiEntry {
  id: string;
  name: string;
  /** http(s) URL of the spec, a path on this origin, or `upload:<file name>` for an uploaded file. */
  specUrl: string;
  /** Overrides the base URL derived from the spec's `servers`. */
  baseUrl: string;
  bearerToken: string;
}

/** Everything that belongs to one API. Stored per API so DTOs of different backends never mix. */
export interface ApiData {
  selectedOpId?: string;
  captured: CapturedObject[];
  mappings: Mapping[];
  drafts: Record<string, OperationDraft>;
}

export interface AppState extends ApiData {
  apis: ApiEntry[];
  activeApiId?: string;
  useProxy: boolean;
  doc?: OpenApiDoc;
  specError?: string;
  specLoading: boolean;
  results: Record<string, ExecResult>;
}

const MAIN_KEY = 'improved-swagger:v2';
const dataKey = (id: string) => `${MAIN_KEY}:data:${id}`;
export const specKey = (id: string) => `${MAIN_KEY}:spec:${id}`;
const MAIN_FIELDS = ['apis', 'activeApiId', 'useProxy'] as const;
const DATA_FIELDS = ['selectedOpId', 'captured', 'mappings', 'drafts'] as const;

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: keep working in memory
  }
}

export const emptyData = (): ApiData => ({ selectedOpId: undefined, captured: [], mappings: [], drafts: {} });

export function loadApiData(id: string): ApiData {
  return { ...emptyData(), ...readJson<Partial<ApiData>>(dataKey(id)) };
}

export function deleteApiStorage(id: string): void {
  try {
    localStorage.removeItem(dataKey(id));
    localStorage.removeItem(specKey(id));
  } catch {
    // ignore
  }
}

function load(): AppState {
  const main = readJson<{ apis?: ApiEntry[]; activeApiId?: string; useProxy?: boolean }>(MAIN_KEY) ?? {};
  const apis = main.apis ?? [];
  const activeApiId = apis.some((a) => a.id === main.activeApiId) ? main.activeApiId : apis[0]?.id;
  return {
    apis,
    activeApiId,
    useProxy: main.useProxy ?? true,
    specLoading: false,
    results: {},
    ...(activeApiId ? loadApiData(activeApiId) : emptyData()),
  };
}

let state = load();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function getActiveApi(): ApiEntry | undefined {
  return state.apis.find((a) => a.id === state.activeApiId);
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const patch = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...patch };
  if (MAIN_FIELDS.some((k) => k in patch)) {
    writeJson(MAIN_KEY, { apis: state.apis, activeApiId: state.activeApiId, useProxy: state.useProxy });
  }
  if (state.activeApiId && DATA_FIELDS.some((k) => k in patch)) {
    writeJson(dataKey(state.activeApiId), Object.fromEntries(DATA_FIELDS.map((k) => [k, state[k]])));
  }
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

// ---- actions -------------------------------------------------------------

export function updateDraft(opId: string, fn: (d: OperationDraft) => OperationDraft): void {
  setState((s) => ({ drafts: { ...s.drafts, [opId]: fn(s.drafts[opId] ?? { params: {} }) } }));
}

export function captureObjects(dto: string, values: unknown[], source: string): number {
  const objects = values.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  if (!objects.length) return 0;
  setState((s) => {
    let captured = [...s.captured];
    for (const data of objects) {
      // Same DTO + same id => replace (a re-fetch updates the cached object instead of duplicating it)
      const existing = captured.findIndex(
        (c) => c.dto === dto && (data.id !== undefined ? c.data.id === data.id : JSON.stringify(c.data) === JSON.stringify(data)),
      );
      const entry: CapturedObject = { id: crypto.randomUUID(), dto, data, source, capturedAt: Date.now() };
      if (existing >= 0) captured[existing] = { ...entry, id: captured[existing].id };
      else captured.push(entry);
    }
    // Keep the cache bounded
    if (captured.length > 500) captured = captured.slice(-500);
    return { captured };
  });
  return objects.length;
}

export function removeCaptured(id: string): void {
  setState((s) => ({ captured: s.captured.filter((c) => c.id !== id) }));
}

export function clearCaptured(dto?: string): void {
  setState((s) => ({ captured: dto ? s.captured.filter((c) => c.dto !== dto) : [] }));
}

export function saveMapping(mapping: Mapping): void {
  setState((s) => ({
    mappings: [...s.mappings.filter((m) => !(m.sourceDto === mapping.sourceDto && m.targetDto === mapping.targetDto)), mapping],
  }));
}

export function deleteMapping(sourceDto: string, targetDto: string): void {
  setState((s) => ({ mappings: s.mappings.filter((m) => !(m.sourceDto === sourceDto && m.targetDto === targetDto)) }));
}

/** Short human label for a captured object: "#3 · Laptop". */
export function objectLabel(c: CapturedObject): string {
  const id = c.data.id ?? c.data.uuid ?? c.data.key;
  const name = ['name', 'title', 'displayName', 'label', 'email', 'username']
    .map((k) => c.data[k])
    .find((v) => typeof v === 'string' && v);
  return [id !== undefined ? `#${String(id)}` : undefined, name as string | undefined].filter(Boolean).join(' · ') || c.source;
}
