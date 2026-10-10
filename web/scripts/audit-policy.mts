/**
 * Evaluates npm audit v2 JSON reports. Any high or critical finding blocks;
 * there are no exceptions. Malformed reports and entries fail closed. The CLI
 * consumer is check-audit.mts.
 *
 * The former GHSA-vfj7-8cjw-p6xm (braces) exception was removed once the
 * `@next/eslint-plugin-next` override in package.json dropped the
 * fast-glob -> micromatch -> braces chain from the tree. If an advisory ever
 * needs a temporary exception again, recover the reviewed-chain matcher from
 * git history rather than loosening this check.
 */

type Vulnerability = {
  severity?: string;
  via?: unknown[];
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
};

const BLOCKING_SEVERITIES = ["high", "critical"];

function isVulnerability(value: unknown): value is Vulnerability {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const severity = (value as Vulnerability).severity;
  return ["info", "low", "moderate", "high", "critical"].includes(
    severity ?? "",
  );
}

export function evaluateAudit(input: unknown): AuditResult {
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
    };
  }

  const blocking = entries.filter(([, vulnerability]) =>
    BLOCKING_SEVERITIES.includes((vulnerability as Vulnerability).severity!)
  ) as Array<[string, Vulnerability]>;

  return {
    ok: blocking.length === 0,
    blocking,
    failures: blocking.map(([name, vulnerability]) =>
      `${name}: ${vulnerability.severity} severity finding`
    ),
  };
}
