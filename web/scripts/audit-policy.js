const EXCEPTION_EXPIRES_AT_ISO = "2026-10-10T00:00:00Z";
const EXCEPTION_EXPIRES_AT = Date.parse(EXCEPTION_EXPIRES_AT_ISO);
const ADVISORY_ID = "GHSA-vfj7-8cjw-p6xm";

const allowedChain = {
  "@next/eslint-plugin-next": {
    via: ["fast-glob"],
    effects: ["eslint-config-next"],
  },
  braces: {
    via: [
      {
        source: 1240992,
        name: "braces",
        dependency: "braces",
        severity: "high",
        url: `https://github.com/advisories/${ADVISORY_ID}`,
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

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  return values
    .map((value) =>
      value && typeof value === "object"
        ? `object:${JSON.stringify(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )}`
        : `${typeof value}:${value}`,
    )
    .sort();
}

function sameList(actual, expected) {
  return JSON.stringify(normalizeList(actual)) ===
    JSON.stringify(normalizeList(expected));
}

function evaluateAudit(report, now = Date.now()) {
  if (
    !report ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object"
  ) {
    const detail = report?.error
      ? JSON.stringify(report.error)
      : "missing vulnerabilities field";
    throw new Error(`npm audit did not return a vulnerability report: ${detail}`);
  }

  const malformed = Object.entries(report.vulnerabilities).filter(
    ([, vulnerability]) =>
      !vulnerability ||
      typeof vulnerability !== "object" ||
      Array.isArray(vulnerability) ||
      !["info", "low", "moderate", "high", "critical"].includes(
        vulnerability.severity,
      ),
  );
  if (malformed.length > 0) {
    return {
      ok: false,
      blocking: [],
      failures: malformed.map(([name]) => `${name}: malformed audit entry`),
      expiresAt: EXCEPTION_EXPIRES_AT_ISO,
    };
  }

  const blocking = Object.entries(report.vulnerabilities).filter(
    ([, vulnerability]) =>
      ["high", "critical"].includes(vulnerability.severity),
  );

  if (blocking.length === 0) {
    return {
      ok: true,
      blocking,
      failures: [],
      expiresAt: EXCEPTION_EXPIRES_AT_ISO,
    };
  }

  const failures = [];
  for (const [name, vulnerability] of blocking) {
    const expected = allowedChain[name];
    if (!expected) {
      failures.push(`${name}: not part of the reviewed advisory chain`);
      continue;
    }
    if (vulnerability.severity !== "high") {
      failures.push(`${name}: expected high severity, got ${vulnerability.severity}`);
      continue;
    }

    const via = Array.isArray(vulnerability.via)
      ? vulnerability.via.map((item) =>
          typeof item === "string"
            ? item
            : item && typeof item === "object"
              ? {
                  source: item.source,
                  name: item.name,
                  dependency: item.dependency,
                  severity: item.severity,
                  url: item.url,
                  range: item.range,
                }
              : item,
        )
      : vulnerability.via;
    if (!sameList(via, expected.via)) {
      failures.push(
        `${name}: advisory/dependency path mismatch; received ${JSON.stringify(vulnerability.via)}`,
      );
      continue;
    }
    if (!sameList(vulnerability.effects, expected.effects)) {
      failures.push(
        `${name}: dependency effects mismatch; received ${JSON.stringify(vulnerability.effects)}`,
      );
      continue;
    }
    const expectedNodes = [`node_modules/${name}`];
    if (!sameList(vulnerability.nodes, expectedNodes)) {
      failures.push(
        `${name}: installed package path mismatch; received ${JSON.stringify(vulnerability.nodes)}`,
      );
    }
  }

  // Keep structural mismatch diagnostics focused; the expiry applies to an otherwise valid exception match.
  if (failures.length === 0 && now >= EXCEPTION_EXPIRES_AT) {
    failures.push(
      `temporary ${ADVISORY_ID} exception expired at ${EXCEPTION_EXPIRES_AT_ISO}`,
    );
  }

  return {
    ok: failures.length === 0,
    blocking,
    failures,
    expiresAt: EXCEPTION_EXPIRES_AT_ISO,
  };
}

module.exports = {
  evaluateAudit,
  EXCEPTION_EXPIRES_AT_ISO,
  ADVISORY_ID,
};
