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
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        "glow-pulse": "glowPulse 3s ease-in-out infinite",
        "scan": "scan 8s linear infinite",
        "flicker": "flicker 4s infinite",
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
      },
    },
  },
  plugins: [],
};
