/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: 'var(--bg-canvas)',
        },
        surface: {
          DEFAULT: 'var(--bg-surface)',
        },
        base: {
          DEFAULT: 'var(--bg-surface)',
        },
        elevated: {
          DEFAULT: 'var(--bg-elevated)',
        },
        border: {
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
        accent: {
          blue: 'var(--accent-blue)',
          purple: 'var(--accent-purple)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      borderRadius: {
        lg: '0.375rem',
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.875rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.18s ease-out',
        'modal-in': 'modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) backwards',
        'row-in': 'rowIn 0.28s ease-out backwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        modalIn: {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        rowIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
