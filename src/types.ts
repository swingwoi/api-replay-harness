// Shared types for the replay harness.

export interface RecordedExchange {
  // Logical name for this exchange (used in diff output).
  name: string;
  request: RecordedRequest;
  response: RecordedResponse;
  // ISO timestamp the recording was captured at.
  recordedAt: string;
}

export interface RecordedRequest {
  method: string;
  // Path + query string only. Base URL lives outside the recording so the
  // same recording can be replayed against any host.
  pathAndQuery: string;
  headers?: Record<string, string>;
  // For JSON bodies, store parsed; for everything else, store as a string.
  body?: unknown;
}

export interface RecordedResponse {
  status: number;
  headers?: Record<string, string>;
  // Same convention as request body.
  body?: unknown;
}

export interface DiffReport {
  exchange: string;
  statusMatch: boolean;
  recordedStatus: number;
  actualStatus: number;
  bodyDiffs: BodyDiff[];
  headerDiffs: HeaderDiff[];
}

export interface BodyDiff {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface HeaderDiff {
  name: string;
  expected: string | undefined;
  actual: string | undefined;
}
