// 自定义模块声明 (无 @types/react-syntax-highlighter)
declare module 'react-syntax-highlighter' {
  import { Component } from 'react';
  export const Prism: any;
}
declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: any;
  export const oneLight: any;
  export const vscDarkPlus: any;
}
