export type VisualAssertErrorCode =
  | 'missing-image'
  | 'invalid-image'
  | 'invalid-label'
  | 'invalid-dataset'
  | 'execution-error';

export class VisualAssertDataError extends Error {
  readonly code: VisualAssertErrorCode;
  readonly sampleId?: string;

  constructor(code: VisualAssertErrorCode, message: string, sampleId?: string) {
    super(message);
    this.name = 'VisualAssertDataError';
    this.code = code;
    this.sampleId = sampleId;
  }
}
