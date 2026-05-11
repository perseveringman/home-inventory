/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff2c7',
          100: '#ffe484',
          500: '#ff4b20',
          600: '#e83315',
          700: '#171717',
        },
        ink: {
          900: '#171717',
          700: '#2a2a2a',
          500: '#55524c',
          400: '#8d8981',
          300: '#d9d6ce',
        },
      },
      boxShadow: {
        soft: '0 5px 0 #171717, 0 14px 28px rgba(23,23,23,0.18)',
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
