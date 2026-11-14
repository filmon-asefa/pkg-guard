import type { ResolvedConfig } from "../config.js";
import type { Runner } from "../runner.js";
import type { Manifest } from "../types.js";

/** Everything a scanner needs. Passed in so scanners are easy to test. */
export interface ScannerContext {
  cwd: string;
  run: Runner;
  config: ResolvedConfig;
  manifest: Manifest;
}
