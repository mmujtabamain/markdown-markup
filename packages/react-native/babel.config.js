// Jest only: React Native's preset compiles this package, the core's TypeScript sources and the
// ESM-only Markdown parsers it uses. Apps bundle with Metro and their own Babel config.
//
// Jest's VM refuses import() without --experimental-vm-modules, and the core loads its maths engine
// with one (on the first MathsEngine.create()), so here import(x) becomes a deferred require(x).
// Metro handles import() itself.
const deferredRequire = ({ types: t }) => ({
  visitor: {
    CallExpression(path) {
      if (path.node.callee.type !== 'Import') return;
      const required = t.callExpression(t.identifier('require'), path.node.arguments);
      path.replaceWith(t.callExpression(t.memberExpression(t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), []), t.identifier('then')), [t.arrowFunctionExpression([], required)]));
    },
  },
});

module.exports = {
  presets: [['module:@react-native/babel-preset', { disableImportExportTransform: false }]],
  plugins: [deferredRequire],
};
