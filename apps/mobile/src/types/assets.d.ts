// Static image assets bundled by Metro (`import logo from '../assets/images/logo-full.png'`).
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
