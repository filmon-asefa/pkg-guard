import * as fs from "node:fs";
import * as path from "node:path";

let cached: string | undefined;

/**
 * Reads this package's own version by walking up from the compiled file to the
 * package.json that declares the "pkg-guard" command. This keeps working if the
 * package is published under a scoped name such as "@you/pkg-guard".
 */
export function getToolVersion(): string {
  if (cached) return cached;
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        version?: unknown;
        bin?: Record<string, unknown> | string;
      };
      const declaresCommand = typeof json.bin === "object" && json.bin !== null && "pkg-guard" in json.bin;
      if (declaresCommand && typeof json.version === "string") {
        cached = json.version;
        return cached;
      }
    } catch {
      /* keep walking up */
    }
    dir = path.dirname(dir);
  }
  cached = "0.0.0";
  return cached;
}
