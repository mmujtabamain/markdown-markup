// Jest with React Native's preset. The core is TypeScript with ESM-only dependencies (mdast,
// micromark and friends), so node_modules is transformed except for packages known to ship
// CommonJS to every condition, and the core's generated maths engine is loaded as its CommonJS build.
const path = require('node:path');

const CJS = [
  'react',
  'react-is',
  'scheduler',
  'react-reconciler',
  'test-renderer',
  'react-test-renderer',
  '@babel',
  'babel-.*',
  'jest-.*',
  '@jest',
  'mathjax-full',
  'speech-rule-engine',
  'pretty-format',
];

module.exports = {
  preset: '@react-native/jest-preset',
  rootDir: __dirname,
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^(\\.\\./)+vendor/maths-engine\\.js$': path.join(__dirname, '../core/vendor/maths-engine.cjs'),
  },
  transformIgnorePatterns: [
    `/node_modules/(?:\\.pnpm/[^/]+/node_modules/)?(?:${CJS.join('|')})/`,
    '/vendor/maths-engine\\.cjs$',
  ],
  // the preset's environment resolves "react-native" and "require" export conditions
  testTimeout: 120000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
};
