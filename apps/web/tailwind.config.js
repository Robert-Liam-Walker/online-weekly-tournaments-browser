/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#06080d", 900: "#0b0f17", 800: "#121826", 700: "#1b2334", 600: "#273047" },
        gold: { 300: "#ffd98a", 400: "#f5b32b", 500: "#e09b12", 600: "#b57c0b" },
        hp: { 500: "#3ddc84", 400: "#7cf0ae" },
        danger: "#ff5c5c",
      },
      fontFamily: {
        arcade: ["\"Press Start 2P\"", "ui-monospace", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: { glow: "0 0 0 1px rgba(245,179,43,.35), 0 0 40px rgba(245,179,43,.15)" },
    },
  },
  plugins: [],
};
