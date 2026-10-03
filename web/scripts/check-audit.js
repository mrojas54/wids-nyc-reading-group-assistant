const { execFileSync } = require("node:child_process");
const { ADVISORY_ID, evaluateAudit } = require("./audit-policy.js");

let stdout;
let commandError;
try {
  stdout = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
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
