import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sage: {
          50:  "var(--color-sage-50)",
          100: "var(--color-sage-100)",
          200: "var(--color-sage-200)",
          300: "var(--color-sage-300)",
          400: "var(--color-sage-400)",
          500: "var(--color-sage-500)",
          600: "var(--color-sage-600)",
          700: "var(--color-sage-700)",
          800: "var(--color-sage-800)",
          900: "var(--color-sage-900)",
        },
        magenta: {
          50:  "var(--color-magenta-50)",
          100: "var(--color-magenta-100)",
          200: "var(--color-magenta-200)",
          300: "var(--color-magenta-300)",
          400: "var(--color-magenta-400)",
          500: "var(--color-magenta-500)",
          600: "var(--color-magenta-600)",
          700: "var(--color-magenta-700)",
          800: "var(--color-magenta-800)",
          900: "var(--color-magenta-900)",
        },
        paper: {
          50:  "var(--color-paper-50)",
          100: "var(--color-paper-100)",
          200: "var(--color-paper-200)",
          300: "var(--color-paper-300)",
          400: "var(--color-paper-400)",
          500: "var(--color-paper-500)",
          600: "var(--color-paper-600)",
          700: "var(--color-paper-700)",
          800: "var(--color-paper-800)",
          900: "var(--color-paper-900)",
        },
        indigo: {
          50:  "var(--color-indigo-50)",
          100: "var(--color-indigo-100)",
          300: "var(--color-indigo-300)",
          500: "var(--color-indigo-500)",
          700: "var(--color-indigo-700)",
          800: "var(--color-indigo-800)",
          900: "var(--color-indigo-900)",
        },
      },
      fontFamily: {
        sans:  ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono:  ["var(--font-mono)"],
      },
      borderRadius: {
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
    },
  },
  plugins: [],
};
export default config;
