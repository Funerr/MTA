import type {
  AuthoringDocument,
  AuthoringPlatform,
} from '../../core/document';

export interface DocumentSummary {
  id: string;
  name: string;
  updatedAt: string;
  caseCount: number;
  platforms: AuthoringPlatform[];
}

export type ImportKindInput = 'paste' | 'text' | 'markdown' | 'excel';

export interface MaskedModelConfig {
  authoring: { baseUrl: string; model: string; apiKeyMasked: string } | null;
  deviceVision: { configured: boolean; model: string | null };
  effective: { source: 'custom' | 'midscene-env'; model: string } | null;
}

export interface TaskView {
  id: string;
  kind: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  endedAt?: string;
  progress: { at: string; message: string }[];
  result?: {
    document?: AuthoringDocument;
    conflict?: boolean;
    message?: string;
    outputs?: {
      caseId: string;
      workflowYaml: string;
      coverage: unknown[];
      actionMapping?: unknown[];
      rewrites?: unknown[];
      issues?: unknown[];
    }[];
    partial?: boolean;
    replaced?: string[];
    appended?: string[];
    caseStatuses?: Record<string, string>;
    mergedCaseCount?: number;
    flaggedExpectations?: string[];
    notes?: string[];
  };
  error?: string;
}

export interface ImportParseResultView {
  kind: string;
  cases: {
    sourceId: string;
    name: string;
    goal: string;
    preconditions: string[];
    actions: string[];
    expectations: { text: string; actionIndex?: number }[];
    level: string;
    sourceRange: string;
    excerpt: string;
  }[];
  issues: { message: string; range?: string }[];
  unconverted: { excerpt: string; reason: string; range?: string }[];
  viaModel?: boolean;
  modelNotes?: string[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const message =
      typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export const api = {
  health: () => request<{ name: string; ok: boolean; version: number }>('./api/health'),

  listDocuments: () =>
    request<{ documents: DocumentSummary[] }>('./api/documents'),

  createDocument: (name: string) =>
    request<{ document: AuthoringDocument }>('./api/documents', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getDocument: (id: string) =>
    request<{ document: AuthoringDocument }>(`./api/documents/${id}`),

  /** baseSaveVersion 为读取时的 saveVersion；409 表示并发冲突。 */
  saveDocument: (document: AuthoringDocument, baseSaveVersion: number) =>
    request<{ document: AuthoringDocument }>(`./api/documents/${document.id}`, {
      method: 'PUT',
      body: JSON.stringify({ document, baseSaveVersion }),
    }),

  deleteDocument: (id: string) =>
    request<{ ok: boolean }>(`./api/documents/${id}`, { method: 'DELETE' }),

  previewImport: (
    input: { kind: ImportKindInput; content?: string; contentBase64?: string },
  ) =>
    request<{ result: ImportParseResultView }>('./api/import/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  applyImport: (
    docId: string,
    input: {
      kind: ImportKindInput;
      name?: string;
      content?: string;
      contentBase64?: string;
      baseSaveVersion: number;
    },
  ) =>
    request<{
      document: AuthoringDocument;
      result: ImportParseResultView;
      report: { addedCases: number; addedIssues: number; unconverted: number };
    }>(`./api/documents/${docId}/import`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getModelConfig: () =>
    request<MaskedModelConfig>('./api/model-config'),

  putModelConfig: (authoring: { baseUrl: string; apiKey: string; model: string } | null) =>
    request<MaskedModelConfig>('./api/model-config', {
      method: 'PUT',
      body: JSON.stringify({ authoring }),
    }),

  generateWorkflow: (
    docId: string,
    input: {
      platform: 'android' | 'harmony';
      baseSaveVersion: number;
      caseIds?: string[];
    },
  ) =>
    request<{ task: TaskView }>(`./api/documents/${docId}/generate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  validateWorkflow: (docId: string, platform: 'android' | 'harmony') =>
    request<{ document: AuthoringDocument; validation: unknown }>(
      `./api/documents/${docId}/validate`,
      { method: 'POST', body: JSON.stringify({ platform }) },
    ),

  getWorkflowCards: (docId: string, platform: 'android' | 'harmony') =>
    request<{
      empty: boolean;
      cards: {
        id: string;
        caseIndex: number;
        caseName: string;
        actionId?: string;
        nodes: {
          stepIndex: number;
          node: string;
          input: unknown;
          meta: Record<string, unknown> | null;
        }[];
      }[];
      rawBlocks: {
        id: string;
        caseIndex: number;
        stepIndex?: number;
        reason: string;
        text: string;
      }[];
      lifecycleSections: string[];
      invalidBuffer: string | null;
    }>(`./api/documents/${docId}/workflow-cards/${platform}`),

  cardEdit: (
    docId: string,
    input: {
      platform: 'android' | 'harmony';
      baseSaveVersion: number;
      edit:
        | { kind: 'updateInput'; caseIndex: number; stepIndex: number; input: unknown }
        | {
            kind: 'insert';
            caseIndex: number;
            afterStepIndex: number;
            node: string;
            input: unknown;
            actionId?: string;
          }
        | { kind: 'delete'; caseIndex: number; stepIndex: number };
    },
  ) =>
    request<{ document: AuthoringDocument }>(`./api/documents/${docId}/workflow-card-edit`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  putWorkflowYaml: (
    docId: string,
    input: { platform: 'android' | 'harmony'; baseSaveVersion: number; yaml: string },
  ) =>
    request<{
      document: AuthoringDocument;
      accepted: boolean;
      error?: { message: string; line?: number; column?: number };
    }>(`./api/documents/${docId}/workflow-yaml`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  getTask: (taskId: string) =>
    request<{ task: TaskView }>(`./api/tasks/${taskId}`),

  cancelTask: (taskId: string) =>
    request<{ task: TaskView }>(`./api/tasks/${taskId}/cancel`, {
      method: 'POST',
    }),

  resolveIssue: (
    docId: string,
    issueId: string,
    input: { baseSaveVersion: number; resolution?: string },
  ) =>
    request<{ document: AuthoringDocument }>(
      `./api/documents/${docId}/issues/${issueId}/resolve`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  mergeGenerated: (
    docId: string,
    input: {
      platform: 'android' | 'harmony';
      baseSaveVersion: number;
      cases: {
        caseId: string;
        workflowYaml: string;
        coverage: unknown[];
        actionMapping?: unknown[];
        rewrites?: unknown[];
        issues?: unknown[];
      }[];
    },
  ) =>
    request<{ document: AuthoringDocument }>(
      `./api/documents/${docId}/merge-generated`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
};
