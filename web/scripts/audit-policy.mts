/**
 * Evaluates npm audit v2 JSON reports. Returns whether high/critical findings
 * pass policy, the blocking entries, and actionable failures. `now` is
 * injectable for deterministic expiry tests; the CLI consumer is check-audit.mts.
 */
export const EXCEPTION_EXPIRES_AT_ISO = "2026-10-10T00:00:00Z";
const EXCEPTION_EXPIRES_AT = Date.parse(EXCEPTION_EXPIRES_AT_ISO);
export const ADVISORY_ID = "GHSA-vfj7-8cjw-p6xm";

if (!Number.isFinite(EXCEPTION_EXPIRES_AT)) {
  throw new Error(`Invalid audit exception expiry: ${EXCEPTION_EXPIRES_AT_ISO}`);
}

type Advisory = {
  source?: number;
  name?: string;
  dependency?: string;
  severity?: string;
  url?: string;
  range?: string;
  [key: string]: unknown;
};

type Vulnerability = {
  severity?: string;
  via?: Array<string | Advisory>;
  effects?: string[];
  nodes?: string[];
};

type AuditReport = {
  vulnerabilities?: Record<string, unknown>;
  error?: unknown;
};

type AuditResult = {
  ok: boolean;
  blocking: Array<[string, Vulnerability]>;
  failures: string[];
  expiresAt: string;
};

const allowedChain: Record<
  string,
  Pick<Vulnerability, "via" | "effects">
> = {
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

function normalizeList(values: unknown): string[] | null {
  if (!Array.isArray(values)) {
    return null;
  }

  return values
    .map((value: unknown) =>
      value && typeof value === "object"
        ? `object:${JSON.stringify(
            Object.keys(value)
              .sort()
              .map((key) => [key, (value as Record<string, unknown>)[key]]),
          )}`
        : `${typeof value}:${value}`,
    )
    .sort();
}

function sameList(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(normalizeList(actual)) ===
    JSON.stringify(normalizeList(expected));
}

function isVulnerability(value: unknown): value is Vulnerability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const severity = (value as Vulnerability).severity;
  return ["info", "low", "moderate", "high", "critical"].includes(
    severity ?? "",
  );
}

export function evaluateAudit(
  input: unknown,
  now = Date.now(),
): AuditResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("npm audit did not return a vulnerability report: invalid report");
  }

  const report = input as AuditReport;
  if (
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  ) {
    const detail = report.error
      ? JSON.stringify(report.error)
      : "missing vulnerabilities field";
    throw new Error(`npm audit did not return a vulnerability report: ${detail}`);
  }

  const entries = Object.entries(report.vulnerabilities);
  const malformed = entries.filter(([, vulnerability]) =>
    !isVulnerability(vulnerability)
  );
  if (malformed.length > 0) {
    return {
      ok: false,
      blocking: [],
      failures: malformed.map(([name]) => `${name}: malformed audit entry`),
      expiresAt: EXCEPTION_EXPIRES_AT_ISO,
    };
  }

  const blocking = entries.filter(([, vulnerability]) =>
    ["high", "critical"].includes((vulnerability as Vulnerability).severity!)
  ) as Array<[string, Vulnerability]>;

  if (blocking.length === 0) {
    return {
      ok: true,
      blocking,
      failures: [],
      expiresAt: EXCEPTION_EXPIRES_AT_ISO,
    };
  }

  const failures: string[] = [];
  for (const [name, vulnerability] of blocking) {
    const expected = allowedChain[name];
    if (!expected) {
      failures.push(`${name}: not part of the reviewed advisory chain`);
      continue;
    }
    if (vulnerability.severity !== "high") {
      failures.push(
        `${name}: expected high severity, got ${vulnerability.severity}`,
      );
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
          : item
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

  // Expiry applies to otherwise valid matches; preserve more specific mismatch diagnostics.
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
