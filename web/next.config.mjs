/** @type {import('next').NextConfig} */
const nextConfig = {
  // Promoted out of `experimental` in Next 15+: these are now stable top-level keys.
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-web",
    "onnxruntime-node",
  ],
  // onnxruntime-web dynamically imports ort-wasm-simd-threaded.mjs at runtime.
  // Vercel's NFT can't trace these dynamic ESM imports, so we force-include
  // the specific files needed by the /api/suggest serverless function.
  outputFileTracingIncludes: {
    "/api/suggest": [
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    ],
  },

  webpack: (config, { isServer }) => {
    // Null-alias onnxruntime-node so @xenova/transformers falls back to WASM.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": false,
    };

    if (isServer) {
      config.externals = [...(config.externals || []), "sharp"];
    }

    return config;
  },
};

export default nextConfig;
