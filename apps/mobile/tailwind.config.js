const { colors } = require('./src/theme/tokens.js');

/**
 * Mirrors apps/web/tailwind.config.ts (shadcn/ui zinc tokens, primary = UniGate green) so both
 * clients look related. NativeWind v4 resolves the CSS variables declared in global.css
 * (`:root` light, `.dark:root` dark); `darkMode: 'class'` lets nativewind's `useColorScheme`
 * follow the system scheme by default or an explicit choice later.
 *
 * Direction: NativeWind maps `ms-/me-/ps-/pe-/text-start` to logical RN styles, so layouts
 * flip under I18nManager RTL without per-locale code — same rule as the web app.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      borderRadius: { lg: '8px', md: '6px', sm: '4px' },
    },
  },
  plugins: [],
};
