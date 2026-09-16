import Ajv from 'ajv';
import {
  ArtifactManifestSchema,
  BLESSED_LIBRARIES,
  type ArtifactManifest,
} from '../../../extension/src/shared/contracts';
import {
  ExtensionToViewerSchema,
  HostToSandboxSchema,
  SANDBOX_OPAQUE_ORIGIN,
  SandboxToHostSchema,
  ViewerToExtensionSchema,
  originAllowed,
  type ExtensionToViewer,
  type HostToSandbox,
  type SandboxToHost,
  type ViewerToExtension,
} from '../protocol';

export interface ViewerHostControllerOptions {
  window: Window;
  iframe: HTMLIFrameElement;
  fetch: typeof fetch;
  artifactBase: string;
  allowedOrigins: readonly string[];
  onManifest?: (manifest: ArtifactManifest) => void;
  onOutbound?: (message: ViewerToExtension, targetOrigin: string) => void;
}

export interface ViewerHostControllerState {
  manifest: ArtifactManifest | null;
  loading: boolean;
  error: ViewerToExtension | null;
}

const ajv = new Ajv({ allErrors: true, strict: false });

function cleanBase(base: string): string {
  return base.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the two postMessage boundaries of the viewer host. Artifact source is
 * fetched as data, but is only interpreted by SandboxRuntime in the opaque
 * iframe; this class never evaluates it.
 */
export class ViewerHostController {
  private readonly options: ViewerHostControllerOptions;
  private readonly artifactBase: string;
  private readonly pending: HostToSandbox[] = [];
  private sandboxReady = false;
  private started = false;
  private disposed = false;
  private activeLoad: { artifactId: string; artifactVersion: number } | null = null;
  private extensionOrigin: string;
  private state: ViewerHostControllerState = { manifest: null, loading: false, error: null };

  constructor(options: ViewerHostControllerOptions) {
    this.options = options;
    this.artifactBase = cleanBase(options.artifactBase || options.window.location.origin);
    this.extensionOrigin = this.findInitialExtensionOrigin();
  }

  getState(): ViewerHostControllerState {
    return this.state;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.window.addEventListener('message', this.handleMessage);
    this.sendToExtension({ type: 'viz.ready' });
  }

  stop(): void {
    if (!this.started || this.disposed) return;
    this.disposed = true;
    this.options.window.removeEventListener('message', this.handleMessage);
    this.pending.length = 0;
  }

  /** Exposed for the jsdom harness and unit tests. */
  handleMessage = (event: MessageEvent): void => {
    if (this.disposed) return;

    if (this.isSandboxEvent(event)) {
      this.handleSandboxMessage(event);
      return;
    }

    // Only the configured extension/top-level origins may control the host.
    // Source checking prevents another same-origin window from controlling it.
    if (!originAllowed(event.origin, this.options.allowedOrigins) || !this.isExtensionSource(event.source)) return;
    this.extensionOrigin = event.origin;

    const parsed = ExtensionToViewerSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case 'viz.load':
        void this.loadArtifact(message);
        break;
      case 'viz.highlight':
        this.sendToSandbox({ type: 'sandbox.highlight', regionId: message.regionId });
        break;
      case 'viz.freeze':
        this.sendToSandbox({ type: 'sandbox.freeze' });
        break;
      case 'viz.clear':
        this.activeLoad = null;
        this.state = { ...this.state, manifest: null, loading: false };
        this.sendToSandbox({ type: 'sandbox.clear' });
        break;
    }
  };

  private async loadArtifact(message: Extract<ExtensionToViewer, { type: 'viz.load' }>): Promise<void> {
    const loadKey = { artifactId: message.artifactId, artifactVersion: message.artifactVersion };
    const previousLoad = this.activeLoad;
    this.activeLoad = loadKey;
    this.state = { ...this.state, loading: true, error: null };

    try {
      const manifestUrl = `${this.artifactBase}/artifacts/${encodeURIComponent(message.artifactId)}/${message.artifactVersion}/manifest.json`;
      const manifestResponse = await this.options.fetch(manifestUrl);
      if (!manifestResponse.ok) throw new Error(`manifest request failed (${manifestResponse.status})`);
      const rawManifest: unknown = await manifestResponse.json();
      this.assertBlessedLibraries(rawManifest);
      const parsedManifest = ArtifactManifestSchema.safeParse(rawManifest);
      if (!parsedManifest.success) {
        throw new Error(`manifest validation failed: ${parsedManifest.error.issues.map((issue) => issue.message).join('; ')}`);
      }
      const manifest = parsedManifest.data;
      if (manifest.artifactId !== message.artifactId || manifest.artifactVersion !== message.artifactVersion) {
        throw new Error('manifest artifact id/version does not match viz.load');
      }
      if (!isRecord(message.parameters)) throw new Error('parameters must be an object');
      const validateParameters = ajv.compile(manifest.parameters as unknown as object);
      if (!validateParameters(message.parameters)) {
        const detail = (validateParameters.errors ?? []).map((issue) => `${issue.instancePath || '/'} ${issue.message ?? 'is invalid'}`).join('; ');
        throw new ParameterValidationError(detail || 'parameters do not match the manifest schema');
      }

      const artifactUrl = `${this.artifactBase}/artifacts/${encodeURIComponent(manifest.artifactId)}/${manifest.artifactVersion}/${manifest.render.entry}`;
      const artifactResponse = await this.options.fetch(artifactUrl);
      if (!artifactResponse.ok) throw new Error(`artifact request failed (${artifactResponse.status})`);
      const html = await artifactResponse.text();
      if (this.activeLoad !== loadKey) return;
      this.state = { manifest, loading: false, error: null };
      this.options.onManifest?.(manifest);
      // A valid second load replaces the previous scene. Do not clear before
      // manifest/parameter gates: an invalid candidate must never disturb a
      // currently rendered approved artifact.
      if (previousLoad) this.sendToSandbox({ type: 'sandbox.clear' });
      this.sendToSandbox({
        type: 'sandbox.load',
        artifactId: manifest.artifactId,
        artifactVersion: manifest.artifactVersion,
        artifactUrl,
        html,
        libraries: manifest.libraries,
        parameters: message.parameters,
        ctx: message.ctx,
      });
    } catch (error) {
      if (this.activeLoad !== loadKey) return;
      const code = error instanceof ParameterValidationError ? 'params' : 'manifest';
      this.reportError(code, errorMessage(error));
      this.state = { ...this.state, loading: false };
    }
  }

  private assertBlessedLibraries(rawManifest: unknown): void {
    const libraries = isRecord(rawManifest) ? rawManifest.libraries : undefined;
    if (!Array.isArray(libraries)) return;
    const unblessed = libraries.filter((library): library is string => typeof library !== 'string' || !(BLESSED_LIBRARIES as readonly string[]).includes(library));
    if (unblessed.length > 0) {
      throw new Error(`manifest names unblessed library: ${unblessed.join(', ')}`);
    }
  }

  private handleSandboxMessage(event: MessageEvent): void {
    if (event.origin !== SANDBOX_OPAQUE_ORIGIN && event.origin !== this.options.window.location.origin) return;
    const parsed = SandboxToHostSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message: SandboxToHost = parsed.data;
    switch (message.type) {
      case 'sandbox.ready':
        this.sandboxReady = true;
        this.flushPending();
        break;
      case 'sandbox.loaded':
        if (this.activeLoad && message.artifactId === this.activeLoad.artifactId && message.artifactVersion === this.activeLoad.artifactVersion) {
          this.sendToExtension({ type: 'viz.loaded', artifactId: message.artifactId, artifactVersion: message.artifactVersion });
        }
        break;
      case 'sandbox.error':
        this.reportError('render', message.message);
        break;
    }
  }

  private sendToSandbox(message: HostToSandbox): void {
    if (!HostToSandboxSchema.safeParse(message).success) return;
    if (!this.sandboxReady) {
      this.pending.push(message);
      return;
    }
    const sandboxWindow = this.options.iframe.contentWindow;
    if (!sandboxWindow) {
      this.reportError('blocked', 'sandbox frame is unavailable');
      return;
    }
    // Sandboxed documents have the serialized opaque origin "null". This is a
    // concrete target and is deliberately never the wildcard "*".
    sandboxWindow.postMessage(message, SANDBOX_OPAQUE_ORIGIN);
  }

  private flushPending(): void {
    const queued = this.pending.splice(0);
    queued.forEach((message) => this.sendToSandbox(message));
  }

  private reportError(code: 'manifest' | 'params' | 'render' | 'blocked', message: string): void {
    const outbound = ViewerToExtensionSchema.parse({ type: 'viz.error', code, message });
    this.state = { ...this.state, error: outbound };
    this.sendToExtension(outbound);
  }

  private sendToExtension(message: ViewerToExtension): void {
    const outbound = ViewerToExtensionSchema.parse(message);
    const targetOrigin = this.extensionOrigin === '*' || this.extensionOrigin === 'chrome-extension://*'
      ? this.options.window.location.origin
      : this.extensionOrigin;
    // Never use a wildcard target. parent is the extension frame in production
    // and the current window in harness/top-level mode.
    this.options.window.parent.postMessage(outbound, targetOrigin || this.options.window.location.origin);
    this.options.onOutbound?.(outbound, targetOrigin || this.options.window.location.origin);
  }

  private isSandboxEvent(event: MessageEvent): boolean {
    const sandboxWindow = this.options.iframe.contentWindow;
    return Boolean(sandboxWindow && event.source === sandboxWindow);
  }

  private isExtensionSource(source: MessageEventSource | null): boolean {
    return source === this.options.window.parent || source === this.options.window;
  }

  private findInitialExtensionOrigin(): string {
    try {
      const referrer = this.options.window.document.referrer;
      if (referrer) {
        const origin = new URL(referrer).origin;
        if (originAllowed(origin, this.options.allowedOrigins)) return origin;
      }
    } catch {
      // A malformed referrer is not an authorization signal; use the configured
      // concrete origin below.
    }
    const concrete = this.options.allowedOrigins.find((origin) => origin !== '*' && !origin.endsWith('://*'));
    return concrete ?? this.options.window.location.origin;
  }
}

class ParameterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParameterValidationError';
  }
}
