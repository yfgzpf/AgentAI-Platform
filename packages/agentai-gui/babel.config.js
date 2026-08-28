module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
  plugins: [
    // antd 按需加载
    ['import', {
      libraryName: 'antd',
      libraryDirectory: 'es',
      style: true,
    }, 'antd'],
    // @ant-design/icons 按需加载
    ['import', {
      libraryName: '@ant-design/icons',
      libraryDirectory: 'lib/icons',
      customName: (name) => {
        return `@ant-design/icons/lib/icons/${name.replace(/^Icon$/, 'icon').replace(/^SvgIcon$/, 'svg-icon')}`;
      },
    }, 'icons'],
  ],
};
