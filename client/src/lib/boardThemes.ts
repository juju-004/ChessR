/**
 * Every board theme: its two square colours, nothing else. The Settings palette
 * draws its swatches from these, and index.css has a matching
 * `.board-theme-<value>` rule per entry (the checkerboard art and the
 * --board-light / --board-dark variables). Add a theme here AND there.
 */
export const BOARD_THEMES = [
  { value: 'brown', light: '#e9d3b0', dark: '#b58863' },
  { value: 'green', light: '#eeeed2', dark: '#769656' },
  { value: 'blue', light: '#dee3e6', dark: '#4b7399' },
  { value: 'gray', light: '#d9d9d9', dark: '#7a7a7a' },
  { value: 'purple', light: '#e8e3f0', dark: '#8877b5' },
  { value: 'walnut', light: '#e8c99b', dark: '#8b5a2b' },
  { value: 'coral', light: '#fbe0d4', dark: '#d9785c' },
  { value: 'ic', light: '#dde6ea', dark: '#5f8ba3' },
  { value: 'midnight', light: '#c9ced6', dark: '#3d4a5c' },
  { value: 'forest', light: '#dfe6cf', dark: '#4a6b4a' },
  { value: 'sand', light: '#f0e6d2', dark: '#c8a97a' },
  { value: 'rose', light: '#f5dfe4', dark: '#c06c84' },
  { value: 'sunset', light: '#fbe3c6', dark: '#e07a3f' },
  { value: 'teal', light: '#d7ebe8', dark: '#3f8f8a' },
  { value: 'plum', light: '#e6d6e4', dark: '#7b4b6e' },
  { value: 'mint', light: '#e4f2e9', dark: '#6fb08a' },
  { value: 'ocean', light: '#d6e6f2', dark: '#2f6f9f' },
  { value: 'crimson', light: '#f1dcdc', dark: '#a8444a' },
  { value: 'charcoal', light: '#bfbfbf', dark: '#404040' },
  { value: 'gold', light: '#f3e7b9', dark: '#b99a3e' },
] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number]['value'];
