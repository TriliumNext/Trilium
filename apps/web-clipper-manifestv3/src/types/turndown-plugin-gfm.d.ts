// Type declaration for turndown-plugin-gfm
declare module 'turndown-plugin-gfm' {
  import TurndownService from 'turndown';

  export interface PluginFunction {
    (service: TurndownService): void;
  }

  export const gfm: PluginFunction;
  export const tables: PluginFunction;
  export const strikethrough: PluginFunction;
  export const taskListItems: PluginFunction;
}
