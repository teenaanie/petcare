/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef3f2',
          100: '#fde8e4',
          200: '#fbd5cd',
          300: '#f8b3a9',
          400: '#f28676',
          500: '#e8604e',
          600: '#d44232',
          700: '#b23326',
          800: '#932d23',
          900: '#7a2b23',
        },
        pet: {
          green: '#22c55e',
          blue: '#3b82f6',
          orange: '#f97316',
          purple: '#a855f7',
        }
      }
    },
  },
  plugins: [],
}
