/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{ts,tsx,html}",
    "../../packages/chat-ui/**/*.{ts,tsx}",
    "../../packages/bots-ui/**/*.{ts,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Bricolage Grotesque"',
          '"Figtree"',
          '"Plus Jakarta Sans"',
          '"Geist"',
          '"Inter"',
          '"Segoe UI Variable"',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          'Ubuntu',
          '"Noto Sans"',
          '"Helvetica Neue"',
          'Arial',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
        ],
        mono: [
          '"Geist Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Monaco',
          'monospace',
        ],
      },
      colors: {
        primary: {
          DEFAULT: "rgb(var(--primary-rgb) / <alpha-value>)",
          fg: "var(--primary-foreground)",
        },
        surface: "rgba(20,20,20,0.6)",
        accent: "#0ea5e9", // sky-500
        "pill-bg": "rgb(var(--compact-pill-bg) / <alpha-value>)",
        "pill-fg": "rgb(var(--compact-pill-fg) / <alpha-value>)",
        "pill-muted": "rgb(var(--compact-pill-fg-muted) / <alpha-value>)",
        /* Theme border tokens — enables border-theme/10, divide-theme/10, ring-theme/10, etc.
           Manual `.border-theme` in styles.css does not support `/opacity` modifiers. */
        theme: {
          DEFAULT: "rgb(var(--border-rgb) / <alpha-value>)",
          card: "rgb(var(--card-border-rgb) / <alpha-value>)",
          sidebar: "rgb(var(--sidebar-border-rgb) / <alpha-value>)",
        },
      },
      boxShadow: {
        soft: "0 10px 24px rgba(0,0,0,0.18)",
        elevate: "0 20px 40px rgba(0,0,0,0.35)",
      },
      borderRadius: {
        xl2: "20px",
      },
    },
  },
  plugins: [],
};
