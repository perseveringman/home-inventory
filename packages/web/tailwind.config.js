/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper-and-ink editorial palette
        paper: {
          DEFAULT: '#f4ede1',
          50: '#faf6ec',
          100: '#f4ede1',
          200: '#ece2d0',
          300: '#e0d4bd',
        },
        ink: {
          900: '#1f1a14',
          700: '#3a3328',
          500: '#6b6151',
          400: '#8d8472',
          300: '#b9af9b',
          200: '#d8cdb6', // hairline rules
        },
        clay: {
          50: '#f4d9cd',
          100: '#e8b9a4',
          500: '#b8472b', // primary accent
          600: '#9a3621',
          700: '#7a2916',
        },
        moss: {
          500: '#5a6a3d',
          600: '#42502c',
        },
        // Tailwind compat — keep these aliased so existing utility classes keep working
        brand: {
          50: '#f4d9cd',
          100: '#e8b9a4',
          500: '#b8472b',
          600: '#9a3621',
          700: '#7a2916',
        },
      },
      boxShadow: {
        soft: '0 1px 0 rgba(31,26,20,0.04), 0 12px 32px -16px rgba(31,26,20,0.18)',
        rise: '0 2px 0 rgba(31,26,20,0.04), 0 24px 48px -24px rgba(31,26,20,0.24)',
        edge: 'inset 0 0 0 1px rgba(31,26,20,0.08)',
      },
      borderRadius: {
        sheet: '14px',
      },
      fontFamily: {
        // UI/body — humanist sans paired with system Chinese
        sans: [
          'Manrope',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        // Display — Fraunces for Latin, Noto Serif SC for Chinese
        serif: [
          'Fraunces',
          'Noto Serif SC',
          'Songti SC',
          'STSong',
          'SimSun',
          'serif',
        ],
      },
      letterSpacing: {
        tightish: '-0.012em',
      },
    },
  },
  plugins: [],
};
