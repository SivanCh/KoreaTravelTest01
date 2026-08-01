/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        ink: '#40514d',
        fog: '#fbfcf9',
        sage: '#a9d4c6',
        sageDeep: '#69a494',
        mint: '#e7f5ef',
        sun: '#f8d98c',
        line: '#eaf0ec'
      },
      fontFamily: {
        sans: ['DM Sans', 'Noto Sans TC', 'sans-serif']
      },
      boxShadow: {
        card: '0 12px 30px rgba(74, 107, 98, 0.07)',
        float: '0 18px 45px rgba(74, 107, 98, 0.11)'
      }
    }
  },
  plugins: []
};
