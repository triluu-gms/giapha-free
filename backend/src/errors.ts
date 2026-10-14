export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Stable id for the frontend to show its own translation (see `error.*` keys
     * in frontend/src/lib/i18n.ts); `message` stays the English fallback.
     */
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
