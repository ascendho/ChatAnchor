export class ThreadRelinkError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThreadRelinkError";
    this.code = code;
  }
}

/** @deprecated Use ThreadRelinkError. */
export { ThreadRelinkError as RepoRecallError };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
