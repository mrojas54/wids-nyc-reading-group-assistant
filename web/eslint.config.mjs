// ESLint flat config. Next 16 removed the `next lint` command, so the project
// invokes ESLint directly (`eslint .`). `eslint-config-next/core-web-vitals`
// ships a flat-config array consumable as-is.
import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"] },
  ...coreWebVitals,
  {
    // eslint-config-next 16 bundles a much stricter eslint-plugin-react-hooks
    // whose `set-state-in-effect` / `refs` rules flag pre-existing component
    // patterns the Next 14 linter never checked. Demoted to warnings so this
    // security/dependency upgrade stays scoped; the flagged components
    // (MermaidDiagram, SocraticMode, PresenterScreen, paperpal/hooks) should
    // be remediated in a separate change.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default config;
