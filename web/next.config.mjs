/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep @xenova/transformers and onnxruntime-web out of the webpack bundle —
  // they ship as runtime requires from node_modules instead. Bundling either
  // fails: onnxruntime-node has native .node binaries (one per OS/arch) that
  // webpack can't parse, and onnxruntime-web ships ESM modules with
  // import.meta.url + createRequire that Terser can't minify in non-module
  // contexts. Both are only needed in the /api/suggest route handler, which
  // runs in the Node runtime (`runtime = "nodejs"`) where requires work fine.
  experimental: {
    serverComponentsExternalPackages: [
      "@xenova/transformers",
      "onnxruntime-web",
      "onnxruntime-node",
    ],
  },

  webpack: (config, { isServer }) => {
    // Defense-in-depth: if @xenova/transformers ever gets pulled into a
    // non-server-component bundle (it shouldn't — but the import only lives
    // in specter2-wasm.ts which is route-handler-only), null-alias the Node
    // ONNX backend so transformers.js falls back to the WASM path.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": false,
    };

    if (isServer) {
      // Some transformers.js code paths reference `sharp` for image work that
      // we never exercise (text-only embedding). Externalize so webpack
      // doesn't try to bundle its native binaries.
      config.externals = [...(config.externals || []), "sharp"];
    }

    return config;
  },
};

export default nextConfig;
