/**
 * Alpha IT Hub — Typography
 * Using Space Grotesk (download TTF files to assets/fonts/)
 * Font files needed:
 *   - SpaceGrotesk-Light.ttf
 *   - SpaceGrotesk-Regular.ttf
 *   - SpaceGrotesk-Medium.ttf
 *   - SpaceGrotesk-SemiBold.ttf
 *   - SpaceGrotesk-Bold.ttf
 */
import { Platform } from 'react-native';

export const Fonts = {
  light: 'SpaceGrotesk-Light',
  regular: 'SpaceGrotesk-Regular',
  medium: 'SpaceGrotesk-Medium',
  semiBold: 'SpaceGrotesk-SemiBold',
  bold: 'SpaceGrotesk-Bold',
} as const;

export const FontSizes = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  '2xl': 28,
  '3xl': 34,
  '4xl': 40,
} as const;

export const LineHeights = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
} as const;

// Pre-built text style objects for common use cases
export const TextStyles = {
  h1: { fontFamily: Fonts.bold, fontSize: FontSizes['3xl'], lineHeight: 40 },
  h2: { fontFamily: Fonts.bold, fontSize: FontSizes['2xl'], lineHeight: 34 },
  h3: { fontFamily: Fonts.semiBold, fontSize: FontSizes.xl, lineHeight: 28 },
  h4: { fontFamily: Fonts.semiBold, fontSize: FontSizes.lg, lineHeight: 26 },
  body: { fontFamily: Fonts.regular, fontSize: FontSizes.base, lineHeight: 22 },
  bodyMedium: { fontFamily: Fonts.medium, fontSize: FontSizes.base, lineHeight: 22 },
  small: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, lineHeight: 18 },
  caption: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, lineHeight: 16 },
  button: { fontFamily: Fonts.semiBold, fontSize: FontSizes.base, lineHeight: 20 },
  label: { fontFamily: Fonts.medium, fontSize: FontSizes.sm, lineHeight: 18 },
} as const;

// Font loading map for expo-font
export const FONT_MAP = {
  [Fonts.light]: require('../../assets/fonts/SpaceGrotesk-Light.ttf'),
  [Fonts.regular]: require('../../assets/fonts/SpaceGrotesk-Regular.ttf'),
  [Fonts.medium]: require('../../assets/fonts/SpaceGrotesk-Medium.ttf'),
  [Fonts.semiBold]: require('../../assets/fonts/SpaceGrotesk-SemiBold.ttf'),
  [Fonts.bold]: require('../../assets/fonts/SpaceGrotesk-Bold.ttf'),
} as const;
