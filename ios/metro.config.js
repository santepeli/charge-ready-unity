const { getDefaultConfig } = require('expo/metro-config');

// Lets the bundled game page ship as a plain asset.
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('html');
module.exports = config;
