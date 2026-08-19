export type CliExitCode = 0 | 2 | 3 | 4 | 5

export class CliError extends Error {
  public readonly code: string
  public readonly exitCode: CliExitCode
  public readonly details: Readonly<Record<string, unknown>> | undefined

  public constructor(
    code: string,
    message: string,
    exitCode: CliExitCode,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.exitCode = exitCode
    this.details = details
  }
}
