const EXCEPTION_EXPIRES_AT_ISO = "2026-10-10T00:00:00Z";
const EXCEPTION_EXPIRES_AT = Date.parse(EXCEPTION_EXPIRES_AT_ISO);

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

function evaluateAudit(report, now = Date.now()) {
  if (!report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    throw new Error("npm audit did not return a vulnerability report");
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

    const via = vulnerability.via.map((item) =>
      typeof item === "string"
        ? item
        : { url: item.url, range: item.range },
    );
    if (JSON.stringify(via) !== JSON.stringify(expected.via)) {
      failures.push(
        `${name}: advisory/dependency path mismatch; received ${JSON.stringify(via)}`,
      );
      continue;
    }
    if (
      JSON.stringify(vulnerability.effects) !==
      JSON.stringify(expected.effects)
    ) {
      failures.push(
        `${name}: dependency effects mismatch; received ${JSON.stringify(vulnerability.effects)}`,
      );
      continue;
    }
    const expectedNodes = [`node_modules/${name}`];
    if (
      JSON.stringify(vulnerability.nodes) !== JSON.stringify(expectedNodes)
    ) {
      failures.push(
        `${name}: installed package path mismatch; received ${JSON.stringify(vulnerability.nodes)}`,
      );
    }
  }

  if (failures.length === 0 && now >= EXCEPTION_EXPIRES_AT) {
    failures.push(
      `temporary GHSA-vfj7-8cjw-p6xm exception expired at ${EXCEPTION_EXPIRES_AT_ISO}`,
    );
  }

  return {
    ok: failures.length === 0,
    blocking,
    failures,
    expiresAt: EXCEPTION_EXPIRES_AT_ISO,
  };
}

module.exports = { evaluateAudit, EXCEPTION_EXPIRES_AT_ISO };
