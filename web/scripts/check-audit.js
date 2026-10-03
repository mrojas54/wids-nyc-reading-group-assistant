const { execFileSync } = require("node:child_process");

const EXCEPTION_EXPIRES_AT = Date.parse("2026-10-10T00:00:00Z");

const allowedChain = {
  "@next/eslint-plugin-next": {
    via: ["fast-glob"],
    effects: ["eslint-config-next"],
  },
  braces: {
    via: [
      {
        url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
        range: "<=3.0.3",
      },
    ],
    effects: ["micromatch"],
  },
  "eslint-config-next": {
    via: ["@next/eslint-plugin-next"],
    effects: [],
  },
  "fast-glob": {
    via: ["micromatch"],
    effects: ["@next/eslint-plugin-next"],
  },
  micromatch: {
    via: ["braces"],
    effects: ["fast-glob"],
  },
};

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

if (!report.vulnerabilities) {
  throw new Error("npm audit did not return a vulnerability report");
}

const blocking = Object.entries(report.vulnerabilities).filter(
  ([, vulnerability]) =>
    ["high", "critical"].includes(vulnerability.severity),
);

if (blocking.length === 0) {
  console.log("No high or critical npm audit findings.");
  process.exit(0);
}

const allowedNames = Object.keys(allowedChain).sort();
const blockingNames = blocking.map(([name]) => name).sort();
const isOnlyAllowedChain =
  Date.now() < EXCEPTION_EXPIRES_AT &&
  JSON.stringify(blockingNames) === JSON.stringify(allowedNames) &&
  blocking.every(([name, vulnerability]) => {
    const expected = allowedChain[name];
    const via = vulnerability.via.map((item) =>
      typeof item === "string"
        ? item
        : { url: item.url, range: item.range },
    );

    return (
      vulnerability.severity === "high" &&
      JSON.stringify(via) === JSON.stringify(expected.via) &&
      JSON.stringify(vulnerability.effects) ===
        JSON.stringify(expected.effects) &&
      JSON.stringify(vulnerability.nodes) ===
        JSON.stringify([`node_modules/${name}`])
    );
  });

if (isOnlyAllowedChain) {
  console.warn(
    "npm audit: temporarily allowing only GHSA-vfj7-8cjw-p6xm via the documented dev dependency chain until 2026-10-10T00:00:00Z.",
  );
  process.exit(0);
}

console.error("npm audit found unapproved high or critical vulnerabilities:");
for (const [name, vulnerability] of blocking) {
  console.error(`- ${name}: ${vulnerability.severity}`);
}
if (Date.now() >= EXCEPTION_EXPIRES_AT) {
  console.error(
    "The temporary GHSA-vfj7-8cjw-p6xm exception expired at 2026-10-10T00:00:00Z.",
  );
}
process.exit(1);
