import type { Config } from 'tailwindcss';

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        // Brand colors
        brand: {
          cream: '#F5F4E7',
          navy: '#000637',
          purple: '#791AFF',
          blue: '#1AA4FF',
          green: '#19FF83',
          yellow: '#FAFF1A',
          orange: '#FF671A',
          pink: '#FF1A8B',
          fuscia: '#D91AFF',
        },
        // Semantic colors with opacity variations
        primary: {
          50: '#F5F0FF',
          100: '#EBE0FF',
          200: '#D6C1FF',
          300: '#C2A3FF',
          400: '#AD84FF',
          500: '#791AFF', // Main purple
          600: '#6115CC',
          700: '#491099',
          800: '#300A66',
          900: '#180533',
        },
        secondary: {
          50: '#E6F6FF',
          100: '#CCEDFF',
          200: '#99DBFF',
          300: '#66C9FF',
          400: '#33B7FF',
          500: '#1AA4FF', // Main blue
          600: '#1583CC',
          700: '#106299',
          800: '#0A4166',
          900: '#052133',
        },
        success: {
          50: '#E6FFF3',
          100: '#CCFFE8',
          200: '#99FFD1',
          300: '#66FFBA',
          400: '#33FFA3',
          500: '#19FF83', // Main green
          600: '#14CC69',
          700: '#0F994F',
          800: '#0A6634',
          900: '#05331A',
        },
      },
      backgroundColor: {
        base: '#F5F4E7', // Cream background
      },
      textColor: {
        base: '#000637', // Navy text
      },
    },
  },
};
