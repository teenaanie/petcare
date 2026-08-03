/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Pippy primary — warm yellow scale
        primary: {
          50:  '#FFFEF0',
          100: '#FFFAD6',
          200: '#FFF5AA',
          300: '#FFEC7A',
          400: '#F9D548',  // THE Pippy yellow
          500: '#F0C420',
          600: '#D4A800',
          700: '#A87E00',
          800: '#7D5D00',
          900: '#4A2C0A',  // dark brown
        },
        // Pippy brand palette
        pippy: {
          yellow: '#F9D548',
          blue:   '#C2DFF0',
          olive:  '#8B9636',
          pink:   '#E8909C',
          brown:  '#4A2C0A',
          cream:  '#FDFBF0',
          card:   '#FFFEF5',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
