const { execFileSync } = require("node:child_process");
const { evaluateAudit } = require("./audit-policy.js");

let report;
try {
  report = JSON.parse(
    execFileSync("npm", ["audit", "--json"], { encoding: "utf8" }),
  );
} catch (error) {
  if (!error.stdout) {
    throw error;
  }
  report = JSON.parse(error.stdout);
}

const result = evaluateAudit(report);

if (result.ok) {
  if (result.blocking.length === 0) {
    console.log("No high or critical npm audit findings.");
  } else {
    console.warn(
      `npm audit: temporarily allowing only GHSA-vfj7-8cjw-p6xm via the documented dev dependency chain until ${result.expiresAt}.`,
    );
  }
  process.exit(0);
}

console.error("npm audit found unapproved high or critical vulnerabilities:");
for (const failure of result.failures) {
  console.error(`- ${failure}`);
}
process.exit(1);
