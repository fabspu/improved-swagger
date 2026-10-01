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

export interface Settings {
  baseUrlOverride: string;
  bearerToken: string;
  useProxy: boolean;
}

export interface AppState {
  specUrl: string;
  doc?: OpenApiDoc;
  specError?: string;
  selectedOpId?: string;
  settings: Settings;
  captured: CapturedObject[];
  mappings: Mapping[];
  drafts: Record<string, OperationDraft>;
  results: Record<string, ExecResult>;
}

const STORAGE_KEY = 'improved-swagger:v1';
const PERSISTED: (keyof AppState)[] = ['specUrl', 'selectedOpId', 'settings', 'captured', 'mappings', 'drafts'];

function load(): AppState {
  const initial: AppState = {
    specUrl: '/mock-api/openapi.json',
    settings: { baseUrlOverride: '', bearerToken: '', useProxy: true },
    captured: [],
    mappings: [],
    drafts: {},
    results: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...initial, ...saved, settings: { ...initial.settings, ...saved.settings } };
  } catch {
    return initial;
  }
}

let state = load();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const patch = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...patch };
  if (PERSISTED.some((k) => k in patch)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, state[k]]))));
    } catch {
      // storage full or unavailable: keep working in memory
    }
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
