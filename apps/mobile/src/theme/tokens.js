/**
 * Colour tokens shared by tailwind.config.js (CSS-variable references) and the few native
 * components that cannot read CSS variables (tab bar, status bar). Plain CommonJS so the
 * Tailwind CLI can require it without TypeScript. Values mirror apps/web/src/app/globals.css.
 */
const colors = {
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
  accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
  popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
  card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
};

/** The same palette resolved to hex (light `--primary: 160 84% 24%` → #0a7050, dark `160 60% 45%` → #2eb886). */
const palette = {
  light: {
    background: '#ffffff',
    foreground: '#09090b',
    primary: '#0a7050',
    muted: '#f4f4f5',
    mutedForeground: '#71717a',
    border: '#e4e4e7',
    card: '#ffffff',
  },
  dark: {
    background: '#09090b',
    foreground: '#fafafa',
    primary: '#2eb886',
    muted: '#27272a',
    mutedForeground: '#a1a1aa',
    border: '#27272a',
    card: '#09090b',
  },
};

module.exports = { colors, palette };
