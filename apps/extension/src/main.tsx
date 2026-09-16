import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './shell/App';
import { loadRemotePack, remotePackUrl } from './shared/remotePack';

const root = createRoot(document.getElementById('root')!);
// A pack named in the URL wins; otherwise a locally hosted build may name a
// default published pack in VITE_ACCESSLENS_PACK_URL so the bare origin shows
// it (the installed extension sets neither and uses the bundled packs).
const defaultPack = import.meta.env.VITE_ACCESSLENS_PACK_URL as string | undefined;
const remote = remotePackUrl(window.location.search) ?? (defaultPack ? remotePackUrl(`?pack=${encodeURIComponent(defaultPack)}`) : null);
if (remote) {
  // A published pack named in the URL renders in place of the bundled
  // choices (decision D7). Failure is shown, not swallowed: a shell that
  // silently fell back to a bundled pack would make a broken publish look fine.
  loadRemotePack(remote)
    .then(pack => root.render(<App pack={pack} />))
    .catch((error: unknown) => {
      root.render(<p role="alert">Could not load the pack at {remote.toString()}: {error instanceof Error ? error.message : String(error)}</p>);
    });
} else {
  root.render(<App />);
}
