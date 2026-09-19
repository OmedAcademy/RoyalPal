const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

/**
 * Force the singleton packages to THIS project's copies.
 *
 * `mobile/` sits inside the RoyalPal web repo, which has its own node_modules
 * containing React 19.2.4 (what Next.js 15 wants) alongside the 19.2.3 that
 * Expo SDK 57 pins here. Node's resolution walks UP the directory tree, so a
 * module resolved from a slightly different path can pick up the web app's
 * copy — which expo-doctor correctly flags as a duplicate native dependency.
 *
 * Two copies of React in one bundle is not a warning, it is a crash: hooks
 * dispatch through module-level state, so a component rendered by one copy
 * with a hook from the other throws "invalid hook call" from code that is
 * obviously correct.
 *
 * `extraNodeModules` rather than `disableHierarchicalLookup`: the blunt
 * version also stops Metro finding a package's OWN nested node_modules and
 * breaks the web entry point, which needs @expo/metro-runtime. This pins the
 * three packages that must be singletons and leaves everything else alone.
 */
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// Nothing outside this directory belongs to the app, so Metro should not watch
// the web app's source or its dependencies.
config.watchFolders = [projectRoot];

module.exports = config;
