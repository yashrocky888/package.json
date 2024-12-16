/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        primary: '#22c55e',
        secondary: '#3b82f6',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} 