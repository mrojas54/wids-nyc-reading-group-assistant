/**
 * Runs `npm audit --json` in the web package and applies audit-policy.mts.
 * Exits 0 when there are no high or critical findings; otherwise prints
 * findings/errors and exits 1. CI usage: `node --experimental-strip-types
 * scripts/check-audit.mts`.
 */
import { execFileSync } from "node:child_process";
import { evaluateAudit } from "./audit-policy.mts";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const auditCommandOptions: {
  encoding: BufferEncoding;
  maxBuffer: number;
  shell?: boolean;
} = {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
};
if (process.platform === "win32") {
  // The command and arguments are fixed; Windows needs a shell to invoke npm.cmd.
  auditCommandOptions.shell = true;
}

function outputString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return Buffer.isBuffer(value) ? value.toString() : undefined;
}

let stdout: string | undefined;
let commandError: {
  message?: string;
  stdout?: unknown;
  stderr?: unknown;
} | undefined;
try {
  stdout = execFileSync(
    npmCommand,
    ["audit", "--json"],
    auditCommandOptions,
  );
} catch (error: unknown) {
  commandError = error as typeof commandError;
  stdout = outputString(commandError?.stdout);
}

const stderr = outputString(commandError?.stderr)?.trim();
if (!stdout) {
  throw new Error(
    `npm audit command failed: ${commandError?.message ?? "no output"}${stderr ? `\n${stderr}` : ""}`,
  );
}

let report: unknown;
try {
  report = JSON.parse(stdout);
} catch (error: unknown) {
  const parseMessage = error instanceof Error ? error.message : String(error);
  throw new Error(
    `npm audit returned invalid JSON: ${parseMessage}${commandError ? `; command failed: ${commandError.message}` : ""}${stderr ? `\n${stderr}` : ""}`,
  );
}

const result = evaluateAudit(report);

if (result.ok) {
  console.log("No high or critical npm audit findings.");
  process.exit(0);
}

console.error("npm audit found unapproved high or critical vulnerabilities:");
for (const failure of result.failures) {
  console.error(`- ${failure}`);
}
process.exit(1);
