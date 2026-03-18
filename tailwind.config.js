/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#9d25f4',
        'primary-deep': '#7c18c7',
        'background-light': '#f7f5f8',
        'background-dark': '#12091b',
        'surface-dark': '#1a1022',
        'surface-soft': '#21112d',
        'surface-border': 'rgba(196, 154, 255, 0.14)',
      },
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 20px 50px rgba(157, 37, 244, 0.24)',
        panel: '0 18px 60px rgba(10, 5, 18, 0.36)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
      },
      backgroundImage: {
        'hero-grid':
          'radial-gradient(circle at top left, rgba(255,255,255,0.12) 0, transparent 32%), radial-gradient(circle at bottom right, rgba(157,37,244,0.18) 0, transparent 40%)',
      },
    },
  },
  plugins: [],
}
