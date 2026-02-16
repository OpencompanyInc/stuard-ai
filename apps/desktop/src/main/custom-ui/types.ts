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
  pages?: Record<string, any>;
  startPage?: string;
  backgroundType?: string;
  backgroundColor?: string;
  gradient?: any;
  backgroundImage?: any;
  shadow?: CustomUiShadow;
  border?: CustomUiBorder;
  animation?: CustomUiAnimation;
  contentPadding?: number;
  overflow?: string;
};
