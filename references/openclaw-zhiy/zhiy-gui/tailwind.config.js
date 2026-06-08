/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#5A67D8',
        secondary: '#F687B3',
        'primary-dark': '#4C51BF',
        'secondary-dark': '#ED64A6',
        dark: '#2D3748',
        'gray-50': '#F7FAFC',
        'gray-100': '#F3F4F6',
        'gray-200': '#E5E7EB',
        'gray-500': '#6B7280',
        'gray-700': '#374151',
        'gray-900': '#111827',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
