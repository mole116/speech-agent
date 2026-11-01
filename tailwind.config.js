/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        agent: {
          dark: '#0a0d14',
          panel: '#111726',
          border: '#1e293b',
          accent: '#38bdf8',
          user: '#2563eb',
          ai: '#10b981',
          tool: '#f59e0b',
          danger: '#ef4444',
        },
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ripple': 'ripple 1.5s ease-out infinite',
      },
      keyframes: {
        ripple: {
          '0%': { transform: 'scale(0.95)', opacity: '1' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
