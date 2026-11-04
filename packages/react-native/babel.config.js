// Jest only: React Native's preset compiles this package, the core's TypeScript sources and the
// ESM-only Markdown parsers it uses. Apps bundle with Metro and their own Babel config.
module.exports = {
  presets: [['module:@react-native/babel-preset', { disableImportExportTransform: false }]],
};
