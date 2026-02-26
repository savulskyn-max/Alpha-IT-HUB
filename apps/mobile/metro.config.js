const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo for hot reloading
config.watchFolders = [workspaceRoot];

// Resolve packages from workspace root to avoid duplicate instances
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Source extensions
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

module.exports = config;
