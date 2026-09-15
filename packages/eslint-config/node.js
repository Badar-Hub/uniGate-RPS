import globals from 'globals';
import { base, noPrismaOutsideApi } from './base.js';

export default [...base, { languageOptions: { globals: { ...globals.node } } }, noPrismaOutsideApi];
