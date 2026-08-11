export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { exitCode?: number; details?: unknown } = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }
}

export function toPublicError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
  exitCode: number;
} {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      exitCode: error.exitCode,
    };
  }

  return {
    code: "UNEXPECTED_ERROR",
    message: "The command failed unexpectedly. No credential details were printed.",
    exitCode: 1,
  };
}
