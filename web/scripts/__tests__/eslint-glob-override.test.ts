// Guards the package.json override that aliases @next/eslint-plugin-next's
// `fast-glob` dependency to `tinyglobby`. fast-glob pulls in
// micromatch -> braces@3.0.3 (GHSA-vfj7-8cjw-p6xm, no patched release), and the
// plugin's only use of it is `globSync(pattern, { onlyDirectories: true })` in
// utils/get-root-dirs.js, which tinyglobby implements.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import eslintConfig from "../../eslint.config.mjs";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(
  require.resolve("@next/eslint-plugin-next/package.json"),
);

describe("@next/eslint-plugin-next fast-glob override", () => {
  it("resolves fast-glob to tinyglobby with a globSync export", () => {
    const pkg = pluginRequire("fast-glob/package.json") as { name: string };
    const glob = pluginRequire("fast-glob") as { globSync?: unknown };

    expect(pkg.name).toBe("tinyglobby");
    expect(typeof glob.globSync).toBe("function");
  });

  it("keeps braces, micromatch and the real fast-glob out of the tree", () => {
    for (const name of ["braces", "micromatch"]) {
      expect(() => require.resolve(`${name}/package.json`)).toThrow();
    }
    expect(() => require.resolve("fast-glob/package.json")).toThrow();
  });

  it("loads the plugin rule that uses the glob", () => {
    const { getRootDirs } = pluginRequire("./dist/utils/get-root-dirs.js") as {
      getRootDirs: (context: { cwd: string; settings: object }) => string[];
    };

    expect(getRootDirs({ cwd: "/repo", settings: {} })).toEqual(["/repo"]);
    expect(
      getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: "app/" } } }),
    ).toContain("app/");
  });

  it("does not configure settings.next.rootDir", () => {
    // tinyglobby expands a bare directory pattern to its subdirectories, unlike
    // fast-glob. With rootDir unset the plugin never globs; revisit the
    // override before setting it.
    const configs = eslintConfig as Array<{ settings?: { next?: object } }>;
    expect(configs.some((config) => config.settings?.next)).toBe(false);
  });
});
