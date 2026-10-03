const { execFileSync } = require("node:child_process");
const { ADVISORY_ID, evaluateAudit } = require("./audit-policy.js");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const auditCommandOptions = {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
};
if (process.platform === "win32") {
  // The command and arguments are fixed; Windows needs a shell to invoke npm.cmd.
  auditCommandOptions.shell = true;
}

let stdout;
let commandError;
try {
  stdout = execFileSync(
    npmCommand,
    ["audit", "--json"],
    auditCommandOptions,
  );
} catch (error) {
  commandError = error;
  stdout = error.stdout?.toString();
}

const stderr = commandError?.stderr?.toString().trim();
if (!stdout) {
  throw new Error(
    `npm audit command failed: ${commandError?.message ?? "no output"}${stderr ? `\n${stderr}` : ""}`,
  );
}

let report;
try {
  report = JSON.parse(stdout);
} catch (error) {
  throw new Error(
    `npm audit returned invalid JSON: ${error.message}${commandError ? `; command failed: ${commandError.message}` : ""}${stderr ? `\n${stderr}` : ""}`,
  );
}

const result = evaluateAudit(report);

if (result.ok) {
  if (result.blocking.length === 0) {
    console.log("No high or critical npm audit findings.");
  } else {
    console.warn(
      `npm audit: temporarily allowing only ${ADVISORY_ID} via the documented dev dependency chain until ${result.expiresAt}.`,
    );
  }
  process.exit(0);
}

console.error("npm audit found unapproved high or critical vulnerabilities:");
for (const failure of result.failures) {
  console.error(`- ${failure}`);
}
process.exit(1);
