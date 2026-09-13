/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // CLT Tenant Hub theme: deep blue / cyan / teal, matches the LINE OA brand direction.
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce2ff',
          300: '#8ed0ff',
          400: '#59b6ff',
          500: '#2f97ff',
          600: '#1c78f0',
          700: '#175fce',
          800: '#174ea6',
          900: '#0f2f57', // deep blue — primary
          950: '#0a1f3d',
        },
        accent: {
          400: '#22d3d3',
          500: '#14b8b8', // teal/cyan accent
          600: '#0e9494',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans Thai"', '"Sarabun"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
