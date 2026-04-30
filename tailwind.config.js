/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary indigo (extracted from login/dashboard screenshots)
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#5B5BD6', // Primary — buttons, active nav, logo
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
        },
        // Surfaces
        surface: {
          page: '#FFFFFF',
          card: '#FFFFFF',
          muted: '#F3F4F6', // Nav pill background, search input bg
          subtle: '#F9FAFB',
        },
        // Text
        ink: {
          primary: '#111827',
          secondary: '#6B7280',
          tertiary: '#9CA3AF',
          inverse: '#FFFFFF',
        },
        // Semantic
        success: {
          50: '#ECFDF5',
          500: '#22C55E',
          600: '#16A34A',
        },
        danger: {
          50: '#FEF2F2',
          500: '#EF4444',
          600: '#DC2626',
        },
        warning: {
          50: '#FFFBEB',
          500: '#F59E0B',
          600: '#D97706',
        },
        // KPI accent backgrounds (from dashboard screenshot pastel chips)
        kpi: {
          mint: '#D1FAE5',
          lavender: '#EDE9FE',
          peach: '#FED7AA',
          rose: '#FCE7F3',
          slate: '#E5E7EB',
          sky: '#DBEAFE',
        },
        // Borders
        border: {
          subtle: '#E5E7EB',
          strong: '#D1D5DB',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        arabic: ['Tajawal', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        pill: '9999px',
        card: '16px',
        input: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        elevated: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
      },
    },
  },
  plugins: [],
};
