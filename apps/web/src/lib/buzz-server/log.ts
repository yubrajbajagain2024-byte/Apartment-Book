import "server-only";

import type { RequestLogLine } from "./types";

/**
 * Request logging for the Buzz write API: method + route TEMPLATE + status + duration, and nothing else — no body,
 * no user id, no thread id (`/api/buzz/[threadId]/replies`, never the real id). Anonymity: a log line must not be
 * joinable to a buzz.
 */
export function formatRequestLog(line: RequestLogLine): string {
  return `[buzz-api] ${line.method} ${line.route} ${line.status} ${Math.max(0, Math.round(line.durationMs))}ms`;
}

export function consoleRequestLog(line: RequestLogLine): void {
  console.info(formatRequestLog(line));
}

export function consoleWarn(message: string): void {
  console.warn(`[buzz-api] ${message}`);
}
