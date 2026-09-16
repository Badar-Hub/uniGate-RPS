const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * pnpm workspace with `node-linker=isolated` (root .npmrc): every dependency is a symlink into
 * `<root>/node_modules/.pnpm/...`, and the workspace packages (`@unigate/api-client`,
 * `@unigate/types`, `@unigate/validation`) are symlinks into `<root>/packages/*`. Metro must
 *   1. watch the whole monorepo so edits in packages/* and the pnpm store are picked up,
 *   2. resolve from both the app's and the root's node_modules,
 *   3. follow symlinks — `resolver.unstable_enableSymlinks` has defaulted to true since Metro 0.80
 *      (SDK 50) and expo-doctor rejects overriding it, so it is left at the default.
 * `expo/metro-config` detects a pnpm workspace and sets 1–2 itself (SDK 52+); they are set
 * explicitly so the behaviour does not depend on that detection. Hierarchical lookup stays on:
 * a package under `.pnpm` finds its own dependencies through its real path's node_modules.
 */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = withNativeWind(config, { input: './global.css' });
