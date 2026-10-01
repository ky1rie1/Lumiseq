/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#18191b', // Neutral canvas surround
          900: '#202124', // Main app background
          850: '#25262a', // Panel background
          800: '#2b2d32', // Card/active background
          750: '#32353a',
          700: '#383b42', // Border color
          600: '#3f3f4a', // Hover border / subtle divider
          500: '#71717e', // Muted text
          400: '#a1a6b0', // Secondary text
          300: '#c0c6d0',
          200: '#e4e4e7', // Primary label
          100: '#f4f4f5', // Bright text
          accent: '#3b82f6', // Studio blue focus
          accentHover: '#2563eb',
        },
      },
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', 'Noto Sans SC', 'Microsoft YaHei UI', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': '0.6875rem', // 11px - ideal for high density studio UI
        'xs': '0.75rem',    // 12px
        'sm': '0.8125rem',  // 13px
      }
    },
  },
  plugins: [],
}
