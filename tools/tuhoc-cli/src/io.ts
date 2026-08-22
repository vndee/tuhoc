/**
 * Where a command writes. Injected rather than reached for, so a command is a
 * function returning an exit code instead of something that calls
 * `process.exit` from four levels down.
 *
 * Convention, and it is the one the tests rely on: **stdout is what happened,
 * stderr is what is wrong.** A contributor piping `tuhoc pack` into anything
 * gets the report on stderr and nothing else mixed into it.
 */
export interface Io {
  /** One line to stdout. Newline added here; callers never write one. */
  out(line: string): void;
  /** One line to stderr. */
  err(line: string): void;
}
