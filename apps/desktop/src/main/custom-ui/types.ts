export type CustomUiShadow = {
  enabled: boolean;
  color?: string;
  blur?: number;
  spread?: number;
  x?: number;
  y?: number;
};

export type CustomUiBorder = {
  enabled: boolean;
  color?: string;
  width?: number;
  style?: string;
};

export type CustomUiAnimation = {
  open?: string;
  close?: string;
  duration?: number;
  easing?: string;
};

export type CustomUiTranslucent = {
  color?: string;
  opacity?: number;
  blur?: number;
  vibrancy?: boolean;
};

export type CustomUiHtmlOptions = {
  id: string;
  title: string;
  css: string;
  layout: any;
  data: any;
  rawHtml?: string;
  borderRadius: number;
  flowId: string;
  transparentBg: boolean;
  initScript?: string;
  component?: string;
  backgroundType?: string;
  backgroundColor?: string;
  gradient?: any;
  backgroundImage?: any;
  translucent?: CustomUiTranslucent;
  shadow?: CustomUiShadow;
  border?: CustomUiBorder;
  animation?: CustomUiAnimation;
  contentPadding?: number;
  overflow?: string;
  invisible?: boolean;
  draggable?: boolean;
  /** UI package bundle (esbuild IIFE) injected before the component runtime. */
  uiPackagesJs?: string;
  /** CSS collected from the bundled UI packages. */
  uiPackagesCss?: string;
  /** Package import names made available to component code. */
  uiPackagesModules?: string[];
};
