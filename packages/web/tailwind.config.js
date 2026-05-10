/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f7ff',
          100: '#e8edff',
          500: '#5b6cff',
          600: '#4a58e0',
          700: '#3a46b8',
        },
        ink: {
          900: '#0f172a',
          700: '#334155',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
        },
      },
      boxShadow: {
        soft: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -8px rgba(15,23,42,0.10)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Helvetica Neue',
          'Arial',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
