/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // BRD §11.2 — visual design tokens
        navy: {
          50: '#F2F6FA',
          100: '#E4EBF3',
          200: '#C9D6E4',
          300: '#9FB6CD',
          400: '#5F7FA3',
          500: '#2F5C86',
          600: '#1F4E79', // links, focus accents
          700: '#13315C', // hover
          800: '#0F2A4A',
          900: '#0B2545', // sidebar, headers, primary buttons
          950: '#071A31',
        },
        surface: '#FFFFFF',
        canvas: '#F5F7FA',
        edge: '#D9E1EA',
        ink: {
          DEFAULT: '#1A1A1A',
          secondary: '#5B6770',
          muted: '#8A96A1',
        },
        success: { DEFAULT: '#1E7B4F', tint: '#E7F4EC' },
        warning: { DEFAULT: '#B7791F', tint: '#FBF2E2' },
        danger: { DEFAULT: '#B42318', tint: '#FBEAE8' },
        info: { DEFAULT: '#1F6FB2', tint: '#E8F2F9' },
        neutral: { DEFAULT: '#6B7785', tint: '#EEF1F5' },
        chart: { monthly: '#1F4E79', quarterly: '#1A7F86', yearly: '#C98A1B', reference: '#B42318', grid: '#E6ECF2' },
        rag: { green: '#1E7B4F', amber: '#B7791F', red: '#B42318' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        h1: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h2: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        h3: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px' },
      borderRadius: { card: '12px', control: '8px', pill: '9999px' },
      boxShadow: {
        card: '0 1px 3px rgba(11,37,69,0.08)',
        raised: '0 4px 16px rgba(11,37,69,0.12)',
        drawer: '-8px 0 24px rgba(11,37,69,0.14)',
      },
      maxWidth: { content: '1440px' },
      gridTemplateColumns: { 12: 'repeat(12, minmax(0, 1fr))' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out both',
        'slide-in-right': 'slide-in-right .22s cubic-bezier(.22,1,.36,1) both',
        'slide-up': 'slide-up .22s cubic-bezier(.22,1,.36,1) both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 1.8s ease-in-out infinite',
      },
      screens: { xs: '360px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    },
  },
  plugins: [],
};
