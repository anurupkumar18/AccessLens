declare module 'jsdom' {
  export interface VirtualConsole {
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export class VirtualConsole {
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export interface JSDOMOptions {
    url?: string;
    runScripts?: 'dangerously' | 'outside-only' | undefined;
    resources?: 'usable' | 'usable' | undefined;
    pretendToBeVisual?: boolean;
    virtualConsole?: VirtualConsole;
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    window: Window;
    serialize(): string;
  }
}
