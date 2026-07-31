import type { Config } from 'tailwindcss';

/**
 * Palette notes: the product sits next to tax-authority material, so the visual language leans
 * institutional rather than start-up. Navy carries the brand; severity colours are deliberately
 * distinguishable by more than hue, since a red/green-only signal fails for the ~8% of men with
 * colour-vision deficiency - every severity is paired with an icon and a text label in the UI.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f5fa',
          100: '#e3eaf4',
          200: '#c2d2e7',
          300: '#8fadd1',
          400: '#5682b6',
          500: '#35619b',
          600: '#264b7e',
          700: '#1e3a63',
          800: '#152a48',
          900: '#0f1e33',
          950: '#091323',
        },
        signal: {
          error: '#b42318',
          errorBg: '#fef3f2',
          warn: '#b54708',
          warnBg: '#fffaeb',
          ok: '#067647',
          okBg: '#ecfdf3',
          info: '#175cd3',
          infoBg: '#eff8ff',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
