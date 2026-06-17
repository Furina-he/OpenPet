/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{vue,ts,html}'],
  theme: {
    extend: {
      colors: {
        'glass-bg': 'var(--ds-glass-bg)',
        'glass-border': 'var(--ds-glass-border)',
        'text-main': 'var(--ds-text-main)',
        'text-sub': 'var(--ds-text-sub)',
        'brand-from': 'var(--ds-brand-from)',
        'brand-to': 'var(--ds-brand-to)',
        cool: 'var(--ds-cool)',
        success: 'var(--ds-success)',
        warning: 'var(--ds-warning)',
        danger: 'var(--ds-danger)',
      },
      borderRadius: { btn: '8px', input: '10px', card: '12px', panel: '16px', bubble: '18px' },
      spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px' },
      fontSize: {
        xs: '12px',
        sm: '13px',
        base: '14px',
        md: '16px',
        lg: '20px',
        xl: '28px',
        '2xl': '36px',
      },
      transitionTimingFunction: { ds: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      backdropBlur: { glass: '28px' },
    },
  },
  plugins: [],
};
