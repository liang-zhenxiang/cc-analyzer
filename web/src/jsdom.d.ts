declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        runScripts?: "dangerously";
        url?: string;
        beforeParse?(window: Window): void;
      }
    );
    window: Window & typeof globalThis;
  }
}
