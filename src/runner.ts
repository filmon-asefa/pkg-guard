import { execFile } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Exit code, or null if the process could not be started / was killed. */
  code: number | null;
  /** Set when the process could not be started or crashed (not a normal non-zero exit). */
  spawnError?: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
}

/** Runs a command and never rejects. Injected into scanners so tests can fake npm. */
export type Runner = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

export const defaultRunner: Runner = (command, args, options) =>
  new Promise<RunResult>((resolve) => {
    const isWindows = process.platform === "win32";
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
        // npm is npm.cmd on Windows, which can only be started through a shell.
        // All arguments are constants defined by pkg-guard, never user input.
        shell: isWindows,
        env: {
          ...process.env,
          npm_config_update_notifier: "false",
          npm_config_fund: "false",
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0, timedOut: false });
          return;
        }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (typeof failure.code === "number") {
          resolve({ stdout, stderr, code: failure.code, timedOut: false });
          return;
        }
        resolve({
          stdout,
          stderr,
          code: null,
          spawnError: failure.message,
          timedOut: failure.killed === true && failure.signal === "SIGTERM",
        });
      },
    );
  });
