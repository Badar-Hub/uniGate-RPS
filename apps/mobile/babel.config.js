/** NativeWind v4 needs its JSX import source and Babel preset; the worklets/reanimated plugin is added by babel-preset-expo. */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
