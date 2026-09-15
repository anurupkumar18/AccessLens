import React, { useEffect, useState } from 'react';
import { InMemorySessionClient, type LiveEvent, type SessionClient } from '../shared/contracts';
import { validEvent, validPack } from '../shared/fixtures';
import { RoleNav, type Role } from './RoleNav';
import { ErrorBoundary } from './ErrorBoundary';

const defaultClient = new InMemorySessionClient();

interface Props {
  client?: SessionClient;
}

export function App({ client = defaultClient }: Props): React.ReactElement {
  const [role, setRole] = useState<Role>('instructor');
  const [event, setEvent] = useState<LiveEvent | null>(null);

  useEffect(() => client.subscribe(setEvent), [client]);

  return (
    <ErrorBoundary>
      <main>
        <header>
          <h1>AccessLens</h1>
          <p>Accessible, instructor-authorized lesson sharing</p>
        </header>
        <RoleNav role={role} onSelect={setRole} />
        {role === 'instructor' ? (
          <section>
            <h2>Instructor session</h2>
            <p>Demo pack: {validPack.title}</p>
            <button onClick={() => client.send(validEvent)}>Send fixture event</button>
            <p role="status">{event ? 'Event sent · sequence ' + event.sequence : 'Ready to share'}</p>
          </section>
        ) : (
          <section>
            <h2>Student view</h2>
            <p>{event && 'regionId' in event ? `Following ${event.regionId} on ${event.assetId}.` : 'Waiting for instructor event.'}</p>
          </section>
        )}
      </main>
    </ErrorBoundary>
  );
}
