/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
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
        surface: "rgba(20,20,20,0.6)",
        accent: "#0ea5e9", // sky-500
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
