/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        blood: {
          DEFAULT: "#e10600",
          dim: "#a00000",
          glow: "#ff1a1a",
        },
        ink: {
          950: "#050505",
          900: "#0a0a0a",
          800: "#111111",
          700: "#1a1a1a",
        },
        // Cyberpunk neon accents (portal theme).
        neon: {
          cyan: "#22d3ee",
          "cyan-glow": "#67e8f9",
          magenta: "#f0f",
          purple: "#a855f7",
          lime: "#a3e635",
        },
      },
      fontFamily: {
        // Loaded via next/font in app/layout.jsx (CSS variables), with graceful fallbacks.
        mono: ["var(--font-jbmono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "glow-pulse": "glowPulse 3s ease-in-out infinite",
        "scan": "scan 8s linear infinite",
        "flicker": "flicker 4s infinite",
        "grid-pan": "gridPan 20s linear infinite",
        "hue": "hue 8s linear infinite",
        "float-slow": "floatSlow 6s ease-in-out infinite",
      },
      keyframes: {
        glowPulse: {
          "0%, 100%": { opacity: "0.6", filter: "drop-shadow(0 0 12px #e10600)" },
          "50%": { opacity: "1", filter: "drop-shadow(0 0 24px #ff1a1a)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        flicker: {
          "0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%": { opacity: "1" },
          "20%, 22%, 24%, 55%": { opacity: "0.6" },
        },
        gridPan: {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "48px 48px" },
        },
        hue: {
          "0%, 100%": { filter: "hue-rotate(0deg)" },
          "50%": { filter: "hue-rotate(25deg)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
    },
  },
  plugins: [],
};
