/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  glob: {
    assetPath: string;
    themeCssUrl?: string;
    themeUseNextAsBase?: string;
    iconPackCss: string;
    device: string;
    headingStyle: string;
    layoutOrientation: string;
    platform: string;
    isElectron: boolean;
    hasNativeTitleBar: boolean;
    hasBackgroundEffects: boolean;
    currentLocale: {
      id: string;
      rtl: boolean;
    };
    activeDialog: any;
  };
  global: typeof globalThis;
}
