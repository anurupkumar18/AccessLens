import { loadBlessedLibraries } from '../blessed/registry';
import {
  HostToSandboxSchema,
  SANDBOX_OPAQUE_ORIGIN,
  SandboxToHostSchema,
  type HostToSandbox,
  type VisualizationContext,
} from '../protocol';

export interface SandboxRuntimeOptions {
  window: Window;
  document: Document;
  fetch: typeof fetch;
  parentOrigin: string;
}

function stringifyError(value: unknown): string {
  // Errors crossing an iframe/jsdom realm are not `instanceof Error` in this
  // realm. Read their standard fields before falling back to serialization.
  if (value && typeof value === 'object') {
    const candidate = value as { stack?: unknown; message?: unknown };
    if (typeof candidate.stack === 'string' && candidate.stack) return candidate.stack;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function artifactRoot(document: Document): HTMLElement {
  const existing = document.getElementById('artifact-root');
  // Cross-realm documents (including the jsdom harness) do not necessarily
  // expose HTMLElement through document.defaultView. Tag/node checks retain
  // the same invariant without relying on a particular browsing realm.
  if (existing && existing.nodeType === 1) return existing as HTMLElement;
  const root = document.createElement('main');
  root.id = 'artifact-root';
  root.setAttribute('aria-label', 'Interactive visualization');
  document.body.appendChild(root);
  return root;
}

/**
 * Runtime installed in sandbox.html. It deliberately owns no extension data,
 * storage, or network credentials. Artifact HTML is interpreted only in this
 * document, which the host embeds with sandbox="allow-scripts" and no
 * allow-same-origin.
 */
export class SandboxRuntime {
  private readonly options: SandboxRuntimeOptions;
  private readonly originalConsoleError: (...args: unknown[]) => void;
  private started = false;
  private frozen = false;
  private disposed = false;
  private loadSerial = 0;
  private reporting = false;
  private artifactListeners: Array<() => void> = [];
  private artifactTimers = new Set<number>();
  private trackArtifactResources = false;
  private originalWindowAdd?: typeof window.addEventListener;
  private originalDocumentAdd?: typeof document.addEventListener;
  private originalSetTimeout?: (...args: any[]) => number;
  private originalSetInterval?: (...args: any[]) => number;

  constructor(options: SandboxRuntimeOptions) {
    this.options = options;
    const runtimeConsole = (options.window as unknown as { console: { error: (...args: unknown[]) => void } }).console;
    this.originalConsoleError = runtimeConsole.error.bind(runtimeConsole);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.window.addEventListener('message', this.handleMessage);
    this.options.window.addEventListener('error', this.handleError);
    this.options.window.addEventListener('unhandledrejection', this.handleRejection);
    this.options.window.addEventListener('keydown', this.handleFrozenKey, true);
    this.options.document.addEventListener('keydown', this.handleFrozenKey, true);
    this.installResourceTracking();
    const runtimeConsole = (this.options.window as unknown as { console: { error: (...args: unknown[]) => void } }).console;
    runtimeConsole.error = (...args: unknown[]) => {
      this.originalConsoleError(...args);
      this.reportError(args.map(stringifyError).join(' '));
    };
    this.post({ type: 'sandbox.ready' });
  }

  stop(): void {
    if (!this.started || this.disposed) return;
    this.disposed = true;
    this.options.window.removeEventListener('message', this.handleMessage);
    this.options.window.removeEventListener('error', this.handleError);
    this.options.window.removeEventListener('unhandledrejection', this.handleRejection);
    this.options.window.removeEventListener('keydown', this.handleFrozenKey, true);
    this.options.document.removeEventListener('keydown', this.handleFrozenKey, true);
    this.restoreResourceTracking();
    const runtimeConsole = (this.options.window as unknown as { console: { error: (...args: unknown[]) => void } }).console;
    runtimeConsole.error = this.originalConsoleError;
  }

  /** Exposed for the jsdom harness and focused runtime tests. */
  handleMessage = (event: MessageEvent): void => {
    if (this.disposed || event.origin !== this.options.parentOrigin || event.source !== this.options.window.parent) return;
    const parsed = HostToSandboxSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case 'sandbox.load':
        void this.load(message);
        break;
      case 'sandbox.highlight':
        this.highlight(message.regionId);
        break;
      case 'sandbox.freeze':
        this.frozen = true;
        break;
      case 'sandbox.clear':
        this.clear();
        break;
    }
  };

  private async load(message: Extract<HostToSandbox, { type: 'sandbox.load' }>): Promise<void> {
    this.clear();
    const serial = ++this.loadSerial;
    this.frozen = false;
    try {
      // The host normally supplies html after fetching it. The URL fallback is
      // retained for a standalone sandbox and for the harness contract.
      const html = message.html ?? await this.fetchArtifact(message.artifactUrl);
      if (serial !== this.loadSerial || this.disposed) return;
      await this.injectArtifact(html, message.artifactUrl);
      if (serial !== this.loadSerial || this.disposed) return;
      await loadBlessedLibraries(message.libraries ?? [], this.options.window);
      const init = (this.options.window as Window & {
        accesslensInit?: (params: Record<string, unknown>, ctx: VisualizationContext) => void;
      }).accesslensInit;
      if (typeof init !== 'function') throw new Error('artifact does not define window.accesslensInit');
      this.trackArtifactResources = true;
      try {
        init(message.parameters, message.ctx);
      } finally {
        this.trackArtifactResources = false;
      }
      this.post({ type: 'sandbox.loaded', artifactId: message.artifactId, artifactVersion: message.artifactVersion });
    } catch (error) {
      if (serial === this.loadSerial && !this.disposed) this.reportError(stringifyError(error));
    }
  }

  private async fetchArtifact(url: string): Promise<string> {
    const response = await this.options.fetch(url);
    if (!response.ok) throw new Error(`artifact request failed (${response.status})`);
    return response.text();
  }

  private async injectArtifact(html: string, artifactUrl: string): Promise<void> {
    const document = this.options.document;
    const root = artifactRoot(document);
    root.replaceChildren();

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const base = document.createElement('base');
    base.href = artifactUrl;
    root.appendChild(base);

    // Copy visible markup and styles into a controlled root. Scripts are
    // recreated rather than assigned through innerHTML because browsers do not
    // execute scripts inserted as inert markup.
    const sourceBody = parsed.body;
    for (const child of Array.from(sourceBody.childNodes)) {
      if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === 'script') continue;
      root.appendChild(document.importNode(child, true));
    }
    for (const style of Array.from(parsed.head.querySelectorAll('style'))) {
      root.appendChild(document.importNode(style, true));
    }

    const scripts: HTMLScriptElement[] = [
      ...Array.from(parsed.head.querySelectorAll('script')),
      ...Array.from(sourceBody.querySelectorAll('script')),
    ];
    this.trackArtifactResources = true;
    try {
      for (const source of scripts) {
        const script = document.createElement('script');
        const sourceUrl = source.getAttribute('src');
        if (sourceUrl) {
          const resolved = new URL(sourceUrl, artifactUrl);
          if (resolved.origin !== new URL(artifactUrl).origin) {
            throw new Error(`artifact script origin is blocked: ${resolved.origin}`);
          }
          script.src = resolved.href;
          await new Promise<void>((resolve, reject) => {
            script.addEventListener('load', () => resolve(), { once: true });
            script.addEventListener('error', () => reject(new Error(`artifact script failed: ${resolved.href}`)), { once: true });
            root.appendChild(script);
          });
        } else {
          script.textContent = source.textContent || '';
          root.appendChild(script);
        }
      }
    } finally {
      this.trackArtifactResources = false;
    }
  }

  private highlight(regionId: string): void {
    const highlight = (this.options.window as Window & { accesslensHighlight?: (id: string) => void }).accesslensHighlight;
    if (typeof highlight !== 'function') return;
    try {
      highlight(regionId);
    } catch (error) {
      this.reportError(stringifyError(error));
    }
  }

  private clear(): void {
    this.loadSerial += 1;
    this.cleanupArtifactResources();
    const root = this.options.document.getElementById('artifact-root');
    root?.replaceChildren();
    const runtimeWindow = this.options.window as Window & {
      accesslensInit?: unknown;
      accesslensHighlight?: unknown;
      onkeydown?: ((event: KeyboardEvent) => void) | null;
    };
    try {
      delete runtimeWindow.accesslensInit;
      delete runtimeWindow.accesslensHighlight;
    } catch {
      runtimeWindow.accesslensInit = undefined;
      runtimeWindow.accesslensHighlight = undefined;
    }
    // Artifacts are allowed to use either addEventListener or the simple
    // onkeydown property. Clear both forms when replacing an artifact.
    runtimeWindow.onkeydown = null;
  }

  private installResourceTracking(): void {
    const runtimeWindow = this.options.window;
    const runtimeDocument = this.options.document;
    this.originalWindowAdd = runtimeWindow.addEventListener.bind(runtimeWindow);
    this.originalDocumentAdd = runtimeDocument.addEventListener.bind(runtimeDocument);
    this.originalSetTimeout = runtimeWindow.setTimeout.bind(runtimeWindow);
    this.originalSetInterval = runtimeWindow.setInterval.bind(runtimeWindow);

    runtimeWindow.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (!listener) return;
      this.originalWindowAdd!(type, listener, options);
      if (this.trackArtifactResources) {
        this.artifactListeners.push(() => runtimeWindow.removeEventListener(type, listener, options));
      }
    }) as typeof runtimeWindow.addEventListener;
    runtimeDocument.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (!listener) return;
      this.originalDocumentAdd!(type, listener, options);
      if (this.trackArtifactResources) {
        this.artifactListeners.push(() => runtimeDocument.removeEventListener(type, listener, options));
      }
    }) as typeof runtimeDocument.addEventListener;
    const resourceWindow = runtimeWindow as unknown as {
      setTimeout: (...args: any[]) => number;
      setInterval: (...args: any[]) => number;
    };
    resourceWindow.setTimeout = (...args: any[]) => {
      const id = this.originalSetTimeout!(...args);
      if (this.trackArtifactResources) this.artifactTimers.add(id);
      return id;
    };
    resourceWindow.setInterval = (...args: any[]) => {
      const id = this.originalSetInterval!(...args);
      if (this.trackArtifactResources) this.artifactTimers.add(id);
      return id;
    };
  }

  private restoreResourceTracking(): void {
    if (this.originalWindowAdd) this.options.window.addEventListener = this.originalWindowAdd;
    if (this.originalDocumentAdd) this.options.document.addEventListener = this.originalDocumentAdd;
    if (this.originalSetTimeout) this.options.window.setTimeout = this.originalSetTimeout;
    if (this.originalSetInterval) this.options.window.setInterval = this.originalSetInterval;
    this.cleanupArtifactResources();
  }

  private cleanupArtifactResources(): void {
    for (const remove of this.artifactListeners.splice(0)) remove();
    for (const id of this.artifactTimers) {
      this.options.window.clearTimeout(id);
      this.options.window.clearInterval(id);
    }
    this.artifactTimers.clear();
  }

  private handleFrozenKey = (event: KeyboardEvent): void => {
    if (!this.frozen) return;
    // Freeze is a host command, not an artifact API. Capturing here prevents a
    // keyboard stepper listener in the artifact from observing the key.
    if (event.key === ' ' || event.code === 'Space' || event.key.startsWith('Arrow')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private handleError = (event: ErrorEvent): void => {
    this.reportError(event.message || stringifyError(event.error));
  };

  private handleRejection = (event: PromiseRejectionEvent): void => {
    this.reportError(stringifyError(event.reason));
  };

  private reportError(message: string): void {
    if (this.reporting || this.disposed) return;
    this.reporting = true;
    try {
      this.post({ type: 'sandbox.error', code: 'render', message: message || 'artifact render error' });
    } finally {
      this.reporting = false;
    }
  }

  private post(message: { type: 'sandbox.ready' } | { type: 'sandbox.loaded'; artifactId: string; artifactVersion: number } | { type: 'sandbox.error'; code: 'render'; message: string }): void {
    const parsed = SandboxToHostSchema.safeParse(message);
    if (!parsed.success) return;
    this.options.window.parent.postMessage(parsed.data, this.options.parentOrigin || SANDBOX_OPAQUE_ORIGIN);
  }
}
