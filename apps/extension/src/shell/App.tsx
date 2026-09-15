import React, { useEffect, useState } from 'react';
import { AccessPackSchema, InMemorySessionClient, type AccessPack, type LiveEvent, type SessionClient } from '../shared/contracts';
import { defaultPreferences, loadPreferences, savePreferences, type StudentPreferences } from '../shared/preferences';
import { InstructorPanel } from '../instructor';
import { createDisplayMediaHost, type CaptureHost, type Scheduler } from '../sources/screen';
import syntheticPack from '../sources/screen/fixtures/test-pack.json';
import { RoleNav, type Role } from './RoleNav';
import { ErrorBoundary } from './ErrorBoundary';

const defaultClient = new InMemorySessionClient();
// Constructing the host calls nothing; capture starts only from the panel's
// Start button (charter A1).
const defaultHost = createDisplayMediaHost();
// Part 2's synthetic test pack stands in until Part 5 delivers the reviewed
// biology pack; swap the import here when it lands.
const defaultPack: AccessPack = AccessPackSchema.parse(syntheticPack);

interface Props {
  client?: SessionClient;
  pack?: AccessPack;
  host?: CaptureHost;
  scheduler?: Scheduler;
}

export function App({ client = defaultClient, pack = defaultPack, host = defaultHost, scheduler }: Props): React.ReactElement {
  const [role, setRole] = useState<Role>('instructor');
  const [event, setEvent] = useState<LiveEvent | null>(null);
  const [preferences, setPreferences] = useState<StudentPreferences>(defaultPreferences);

  useEffect(() => client.subscribe(setEvent), [client]);
  useEffect(() => { loadPreferences().then(setPreferences); }, []);

  function toggleReducedMotion(): void {
    const next = { ...preferences, reducedMotion: !preferences.reducedMotion };
    setPreferences(next);
    void savePreferences(next);
  }

  return (
    <ErrorBoundary>
      <main>
        <header>
          <h1>AccessLens</h1>
          <p>Accessible, instructor-authorized lesson sharing</p>
        </header>
        <RoleNav role={role} onSelect={setRole} />
        {role === 'instructor' ? (
          <InstructorPanel client={client} pack={pack} host={host} scheduler={scheduler} />
        ) : (
          <section>
            <h2>Student view</h2>
            <p>{event && 'regionId' in event ? `Following ${event.regionId} on ${event.assetId}.` : 'Waiting for instructor event.'}</p>
            <p>
              <label htmlFor="reduced-motion-toggle">
                <input id="reduced-motion-toggle" type="checkbox" checked={preferences.reducedMotion} onChange={toggleReducedMotion} />
                {' '}Reduce motion
              </label>
            </p>
          </section>
        )}
      </main>
    </ErrorBoundary>
  );
}
