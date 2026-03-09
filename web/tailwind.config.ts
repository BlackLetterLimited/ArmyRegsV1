import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0b0b0b",
        panel: "#141414",
        border: "#262626",
        "text-primary": "#f3f4f6",
        "text-secondary": "#a1a1aa",
        accent: "#355e3b",
        "accent-hover": "#4b7a53"
      }
    }
  }
};

export default config;

