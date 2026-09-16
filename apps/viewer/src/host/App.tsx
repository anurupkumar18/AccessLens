import { useEffect, useRef, useState } from 'react';
import { ViewerHostController } from './controller';
import { parseAllowedOrigins, type ExtensionToViewer } from '../protocol';
import type { ArtifactManifest } from '../../../extension/src/shared/contracts';
import './host.css';

export interface HostAppProps {
  artifactBase?: string;
  allowedOrigins?: string;
  initialManifest?: ArtifactManifest | null;
  initialParameters?: Record<string, unknown>;
}

const defaultContext = {
  slideTitle: 'Visualization',
  slideDescription: '',
  lessonContext: '',
};

function artifactBaseFromEnvironment(): string {
  const configured = import.meta.env.VITE_ACCESSLENS_ARTIFACT_BASE as string | undefined;
  return configured?.trim() || window.location.origin;
}

function allowedOriginsFromEnvironment(): string[] {
  return parseAllowedOrigins(
    import.meta.env.VITE_ACCESSLENS_ALLOWED_ORIGINS as string | undefined,
    window.location.origin,
  );
}

export function HostApp({
  artifactBase = artifactBaseFromEnvironment(),
  allowedOrigins,
  initialManifest = null,
  initialParameters,
}: HostAppProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [manifest, setManifest] = useState<ArtifactManifest | null>(initialManifest);
  const [error, setError] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState('');
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<ViewerHostController | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    const controller = new ViewerHostController({
      window,
      iframe,
      fetch,
      artifactBase,
      allowedOrigins: allowedOrigins ? parseAllowedOrigins(allowedOrigins, window.location.origin) : allowedOriginsFromEnvironment(),
      onManifest: (nextManifest) => {
        setManifest(nextManifest);
        setKeyboard(nextManifest.accessibility.keyboard);
        setError(null);
      },
      onOutbound: (message) => {
        if (message.type === 'viz.error') setError(message.message);
      },
    });
    controllerRef.current = controller;
    controller.start();
    if (initialManifest) {
      setKeyboard(initialManifest.accessibility.keyboard);
    }
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [artifactBase, allowedOrigins, initialManifest]);

  useEffect(() => {
    setLoading(controllerRef.current?.getState().loading ?? false);
  }, [manifest]);

  // Harnesses and local demos can opt into a load from the query string. The
  // extension remains the normal client and sends the exact viz.load protocol.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') !== 'harness' || !initialManifest) return;
    const message: ExtensionToViewer = {
      type: 'viz.load',
      packId: 'harness',
      packVersion: 1,
      assetId: 'harness-asset',
      artifactId: initialManifest.artifactId,
      artifactVersion: initialManifest.artifactVersion,
      parameters: initialParameters ?? initialManifest.defaultParameters,
      ctx: {
        slideTitle: initialManifest.title,
        slideDescription: initialManifest.accessibility.description,
        lessonContext: initialManifest.summary,
      },
    };
    window.dispatchEvent(new MessageEvent('message', {
      data: message,
      origin: window.location.origin,
      source: window,
    }));
  }, [initialManifest, initialParameters]);

  const outline = manifest?.accessibility.semanticOutline ?? [];
  return (
    <main className="viewer-host" aria-labelledby="viewer-title">
      <header className="viewer-header">
        <p className="eyebrow">AccessLens Visualize</p>
        <h1 id="viewer-title">{manifest?.title ?? 'Waiting for a visualization'}</h1>
        {manifest ? <p>{manifest.accessibility.description}</p> : <p>Choose a reviewed visualization from the lesson.</p>}
      </header>
      <div className="viewer-layout">
        <aside className="viewer-accessibility" aria-label="Accessible description">
          <h2>Instructional outline</h2>
          {outline.length > 0 ? (
            <ol>
              {outline.map((entry) => <li key={entry}>{entry}</li>)}
            </ol>
          ) : <p>No outline was supplied for this visualization.</p>}
          <p className="keyboard-announcement" aria-live="polite">{keyboard}</p>
        </aside>
        <section className="viewer-stage" aria-label="Visualization stage">
          {loading ? <p role="status">Loading visualization…</p> : null}
          <iframe
            ref={iframeRef}
            title={manifest?.title ?? 'Interactive visualization'}
            src="./sandbox.html"
            sandbox="allow-scripts"
            aria-describedby="viewer-keyboard-hint"
          />
          <p id="viewer-keyboard-hint" className="visually-hidden">{keyboard}</p>
          {error ? <p className="viewer-error" role="alert">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
