/**
 * Alpha IT Hub — Brand Color Palette
 * All colors match the official spec v1.0
 */

export const Colors = {
  // Brand colors
  primary: '#32576F',
  dark: '#132229',
  muted: '#CDD4DA',
  white: '#FFFFFF',
  accent: '#ED7C00',

  // Semantic aliases
  background: '#132229',
  surface: '#1E3340',
  surfaceAlt: '#243D4D',
  border: '#32576F',
  textPrimary: '#FFFFFF',
  textSecondary: '#CDD4DA',
  textMuted: '#7A9BAD',

  // Status colors
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  info: '#2196F3',

  // Notification urgency
  urgencyInformative: '#32576F',
  urgencyActionRequired: '#ED7C00',
  urgencyCritical: '#F44336',

  // Transparent overlays
  overlay: 'rgba(19, 34, 41, 0.85)',
  overlayLight: 'rgba(19, 34, 41, 0.5)',
} as const;

export type ColorKey = keyof typeof Colors;
