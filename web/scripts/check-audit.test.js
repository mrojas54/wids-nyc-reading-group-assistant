const assert = require("node:assert/strict");
const test = require("node:test");
const {
  evaluateAudit,
  EXCEPTION_EXPIRES_AT_ISO,
  ADVISORY_ID,
} = require("./audit-policy.js");

const reviewedChain = {
  "@next/eslint-plugin-next": {
    severity: "high",
    via: ["fast-glob"],
    effects: ["eslint-config-next"],
    nodes: ["node_modules/@next/eslint-plugin-next"],
  },
  braces: {
    severity: "high",
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
    nodes: ["node_modules/braces"],
  },
  "eslint-config-next": {
    severity: "high",
    via: ["@next/eslint-plugin-next"],
    effects: [],
    nodes: ["node_modules/eslint-config-next"],
  },
  "fast-glob": {
    severity: "high",
    via: ["micromatch"],
    effects: ["@next/eslint-plugin-next"],
    nodes: ["node_modules/fast-glob"],
  },
  micromatch: {
    severity: "high",
    via: ["braces"],
    effects: ["fast-glob"],
    nodes: ["node_modules/micromatch"],
  },
};

test("allows the exact reviewed chain before expiry", () => {
  const result = evaluateAudit(
    { vulnerabilities: reviewedChain },
    Date.parse("2026-10-09T23:59:59Z"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.expiresAt, EXCEPTION_EXPIRES_AT_ISO);
});

test("allows a verified subset if the dependency chain shrinks", () => {
  const result = evaluateAudit(
    { vulnerabilities: { braces: reviewedChain.braces } },
    Date.parse("2026-10-09T23:59:59Z"),
  );

  assert.equal(result.ok, true);
});

test("matches advisory object fields regardless of key order", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      braces: {
        ...reviewedChain.braces,
        via: [
          {
            range: "<=3.0.3",
            severity: "high",
            dependency: "braces",
            name: "braces",
            source: 1240992,
            url: reviewedChain.braces.via[0].url,
          },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
});

test("rejects an unexpected advisory path", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      braces: {
        ...reviewedChain.braces,
        via: [{ url: "https://example.test/advisory", range: "<=3.0.3" }],
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /advisory\/dependency path mismatch/);
});

test("rejects advisory source, package, dependency, and severity mismatches", () => {
  for (const [field, value] of [
    ["source", 123],
    ["name", "another-package"],
    ["dependency", "another-package"],
    ["severity", "critical"],
  ]) {
    const result = evaluateAudit({
      vulnerabilities: {
        braces: {
          ...reviewedChain.braces,
          via: [{ ...reviewedChain.braces.via[0], [field]: value }],
        },
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0], /advisory\/dependency path mismatch/);
  }
});

test("rejects mismatched dependency effects and install locations", () => {
  for (const [field, value, expectedMessage] of [
    ["effects", ["different-parent"], /dependency effects mismatch/],
    ["nodes", ["node_modules/other-location"], /installed package path mismatch/],
  ]) {
    const result = evaluateAudit({
      vulnerabilities: {
        braces: { ...reviewedChain.braces, [field]: value },
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0], expectedMessage);
  }
});

test("rejects findings outside the approved dependency chain", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      other: {
        severity: "high",
        via: [],
        effects: [],
        nodes: ["node_modules/other"],
      },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /not part of the reviewed advisory chain/);
});

test("rejects critical findings even when the chain matches", () => {
  const result = evaluateAudit({
    vulnerabilities: {
      braces: { ...reviewedChain.braces, severity: "critical" },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /expected high severity, got critical/);
});

test("rejects the reviewed advisory at its expiry instant", () => {
  const result = evaluateAudit(
    { vulnerabilities: { braces: reviewedChain.braces } },
    Date.parse(EXCEPTION_EXPIRES_AT_ISO),
  );

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /exception expired/);
});

test("rejects the full reviewed chain at expiry", () => {
  const result = evaluateAudit(
    { vulnerabilities: reviewedChain },
    Date.parse(EXCEPTION_EXPIRES_AT_ISO),
  );

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /exception expired/);
});

test("rejects a remaining non-braces chain entry at expiry", () => {
  const result = evaluateAudit(
    {
      vulnerabilities: {
        "@next/eslint-plugin-next": reviewedChain["@next/eslint-plugin-next"],
      },
    },
    Date.parse(EXCEPTION_EXPIRES_AT_ISO),
  );

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /exception expired/);
});

test("reports an invalid chain mismatch without masking it as an expiry", () => {
  const result = evaluateAudit(
    {
      vulnerabilities: {
        braces: {
          ...reviewedChain.braces,
          via: [{ url: "https://example.test/advisory", range: "<=3.0.3" }],
        },
      },
    },
    Date.parse(EXCEPTION_EXPIRES_AT_ISO),
  );

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /advisory\/dependency path mismatch/);
  assert.doesNotMatch(result.failures.join("\n"), /exception expired/);
});

test("rejects malformed vulnerability entries with a clear diagnostic", () => {
  const result = evaluateAudit({
    vulnerabilities: { braces: null },
  });

  assert.equal(result.ok, false);
  assert.match(result.failures[0], /braces: malformed audit entry/);
});

test("rejects audit entries without a recognized severity", () => {
  for (const severity of [undefined, "unknown"]) {
    const vulnerability = { ...reviewedChain.braces };
    if (severity === undefined) {
      delete vulnerability.severity;
    } else {
      vulnerability.severity = severity;
    }

    const result = evaluateAudit({
      vulnerabilities: { braces: vulnerability },
    });

    assert.equal(result.ok, false);
    assert.match(result.failures[0], /braces: malformed audit entry/);
  }
});

test("expiry constant parses to a finite timestamp", () => {
  assert.ok(Number.isFinite(Date.parse(EXCEPTION_EXPIRES_AT_ISO)));
});

test("includes npm audit error payloads in malformed report diagnostics", () => {
  assert.throws(
    () => evaluateAudit({ error: { code: "ECONNRESET", summary: "registry unavailable" } }),
    /ECONNRESET/,
  );
});

test("handles null and undefined npm audit reports", () => {
  for (const report of [null, undefined]) {
    assert.throws(
      () => evaluateAudit(report),
      /npm audit did not return a vulnerability report/,
    );
  }
});
