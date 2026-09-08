import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The .mts extension is load-bearing, not cosmetic. Vite warns that
// `configLoader: 'native'` will become the default in a future major, at which
// point a .ts config containing ESM syntax stops loading as CommonJS. Naming
// the file .mts loads it as ESM today and matches the other config files in
// this directory (eslint.config.mjs, next.config.mjs, postcss.config.mjs).
//
// Consequence of being real ESM: `__dirname` does not exist here. Use
// `import.meta.dirname` (Node >= 20.11; package.json pins engines >= 22.12.0).
//
// Path alias mirrors tsconfig.json `paths: { "@/*": ["./*"] }` so test imports
// like `@/components/...` resolve the same way Next.js resolves them.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  },
});
