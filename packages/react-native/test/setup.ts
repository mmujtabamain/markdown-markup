// A stand-in for @shopify/react-native-skia: the renderer requires it optionally, so this virtual
// module makes the real detection path find "Skia" and draw pixels through these components.
jest.mock(
  '@shopify/react-native-skia',
  () => {
    const { createElement } = require('react');
    const { View } = require('react-native');
    return {
      Skia: { RuntimeEffect: { Make: (sksl: string) => (sksl.includes('half4 main') ? { sksl } : null) } },
      Canvas: ({ children, style }: { children?: unknown; style?: object }) => createElement(View, { testID: 'skia-canvas', style }, children),
      Fill: ({ children }: { children?: unknown; style?: object }) => createElement(View, { testID: 'skia-fill' }, children),
      Shader: ({ uniforms }: { uniforms: Record<string, unknown> }) => createElement(View, { testID: 'skia-shader', accessibilityHint: JSON.stringify(uniforms) }),
    };
  },
  { virtual: true },
);
