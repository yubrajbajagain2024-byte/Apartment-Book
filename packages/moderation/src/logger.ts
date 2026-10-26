/**
 * The engine's only side channel: error logs (UniVerse imported its server logger here). Injected so the host decides
 * where they go. Messages are fixed strings; errors are reduced to their name and message — never the moderated text,
 * never a user id.
 */
export interface ModerationLogger {
  error(message: string, err?: unknown): void;
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return err === undefined ? '' : typeof err;
}

const CONSOLE_LOGGER: ModerationLogger = {
  error(message, err) {
    console.error(`[moderation] ${message}`, describe(err));
  },
};

let current: ModerationLogger = CONSOLE_LOGGER;

/** Replace the logger (null restores the console one). */
export function setModerationLogger(logger: ModerationLogger | null): void {
  current = logger ?? CONSOLE_LOGGER;
}

export const log: ModerationLogger = {
  error(message, err) {
    try {
      current.error(message, err);
    } catch {
      /* a broken logger must never break moderation */
    }
  },
};
