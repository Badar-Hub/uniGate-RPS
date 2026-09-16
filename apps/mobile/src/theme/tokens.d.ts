export interface PaletteScheme {
  background: string;
  foreground: string;
  primary: string;
  muted: string;
  mutedForeground: string;
  border: string;
  card: string;
}
export declare const colors: Record<string, string | Record<string, string>>;
export declare const palette: { light: PaletteScheme; dark: PaletteScheme };
