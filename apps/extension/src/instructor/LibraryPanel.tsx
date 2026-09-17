import React, { useEffect, useRef, useState } from 'react';
import type { AuthoringClient, CourseDocument, CourseProfile, DocumentKind, ProfileWithDocuments } from '../shared/authoringClient';

interface Props {
  client: AuthoringClient;
  profiles: CourseProfile[];
  onProfilesChange(profiles: CourseProfile[]): void;
  pollMs?: number;
}

const KINDS: Array<{ value: DocumentKind; label: string }> = [
  { value: 'textbook', label: 'Textbook' },
  { value: 'slides', label: 'Slides' },
  { value: 'notes', label: 'Lecture notes' },
  { value: 'reading', label: 'Approved reading' },
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'other', label: 'Other' },
];

const STATUS_TEXT: Record<CourseDocument['status'], string> = {
  pending: 'Waiting to index.',
  extracting: 'Reading the pages.',
  chunking: 'Splitting into passages.',
  embedding: 'Indexing for retrieval.',
  verifying: 'Checking retrieval.',
  ready: 'Ready.',
  failed: 'Indexing failed.',
};

type LibraryView = 'courses' | 'new';

const VIEWS: Array<{ id: LibraryView; label: string }> = [
  { id: 'courses', label: 'Courses' },
  { id: 'new', label: 'New course' },
];

const indexing = (document: CourseDocument) => document.status !== 'ready' && document.status !== 'failed';

/**
 * The instructor's course library (spec section 9, D13): course profiles
 * and the materials in them. Every document is indexed so the authoring
 * pipeline can quote it, by page, in the descriptions it writes. Students
 * never see this panel or these files; only capped, cited quotes reach a
 * published pack.
 */
export function LibraryPanel({ client, profiles, onProfilesChange, pollMs = 5000 }: Props): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(profiles[0]?.profileId ?? null);
  // Two views, not one wall of fields: the courses that exist and what is in
  // them, or the form for a new one. A library with no courses opens on the
  // form because there is nothing else to show.
  const [view, setView] = useState<LibraryView>(profiles.length > 0 ? 'courses' : 'new');
  const [details, setDetails] = useState<ProfileWithDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newProfile, setNewProfile] = useState({ name: '', subject: '', level: '' });
  const [newDocument, setNewDocument] = useState<{ kind: DocumentKind; title: string; file: File | null }>({ kind: 'notes', title: '', file: null });
  /** Bumped after a change so the load-and-poll effect re-arms. */
  const [refresh, setRefresh] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    if (selected && !profiles.some(profile => profile.profileId === selected)) setSelected(profiles[0]?.profileId ?? null);
    else if (!selected && profiles[0]) setSelected(profiles[0].profileId);
  }, [profiles, selected]);

  // Load the selected profile, and keep polling while anything is indexing.
  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    let stopped = false;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await client.getProfile(selected);
        if (stopped) return;
        setDetails(next);
        if (next.documents.some(indexing)) handle = setTimeout(() => { void tick(); }, pollMs);
      } catch (e) { if (!stopped) fail(e); }
    };
    void tick();
    return () => { stopped = true; if (handle) clearTimeout(handle); };
  }, [client, selected, pollMs, refresh]);

  async function createProfile(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!newProfile.name.trim() || !newProfile.subject.trim() || !newProfile.level.trim()) return;
    setBusy(true); setError(null);
    try {
      const created = await client.createProfile({ name: newProfile.name.trim(), subject: newProfile.subject.trim(), level: newProfile.level.trim() });
      onProfilesChange([created.profile, ...profiles]);
      setSelected(created.profile.profileId);
      setNewProfile({ name: '', subject: '', level: '' });
      setView('courses');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function addDocument(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected || !newDocument.file || !newDocument.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const file = newDocument.file;
      const created = await client.addDocument(selected, { name: file.name, type: file.type, body: file }, { kind: newDocument.kind, title: newDocument.title.trim() });
      setDetails(current => current && current.profile.profileId === selected
        ? { ...current, documents: [created, ...current.documents.filter(d => d.docId !== created.docId)] }
        : current);
      setNewDocument({ kind: newDocument.kind, title: '', file: null });
      if (fileInput.current) fileInput.current.value = '';
      // Re-arm polling: the new document is indexing.
      setRefresh(n => n + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function removeDocument(docId: string): Promise<void> {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await client.deleteDocument(selected, docId);
      setDetails(current => current ? { ...current, documents: current.documents.filter(d => d.docId !== docId) } : current);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function removeProfile(): Promise<void> {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await client.deleteProfile(selected);
      const remaining = profiles.filter(profile => profile.profileId !== selected);
      onProfilesChange(remaining);
      setSelected(null);
      if (remaining.length === 0) setView('new');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <section className="library" aria-labelledby="library-heading">
      <h3 id="library-heading">Course library</h3>
      <p className="supporting-text">Textbooks, notes and past slides for a course. The pipeline quotes them, by page, in the descriptions it writes; students only ever see those cited quotes.</p>

      <div className="mode-tabs library-tabs" role="tablist" aria-label="Course library views">
        {VIEWS.map(candidate => (
          <button
            key={candidate.id}
            id={`library-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={view === candidate.id}
            aria-controls="library-view"
            tabIndex={view === candidate.id ? 0 : -1}
            onClick={() => setView(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div id="library-view" role="tabpanel" aria-labelledby={`library-tab-${view}`}>
        {view === 'new' && (
          <form onSubmit={e => { void createProfile(e); }} aria-label="Create a course" className="library-new-course">
            <label htmlFor="library-name">Course<input id="library-name" type="text" value={newProfile.name} maxLength={200} onChange={e => setNewProfile({ ...newProfile, name: e.target.value })} /></label>
            <label htmlFor="library-subject">Subject<input id="library-subject" type="text" value={newProfile.subject} maxLength={120} onChange={e => setNewProfile({ ...newProfile, subject: e.target.value })} /></label>
            <label htmlFor="library-level">Level<input id="library-level" type="text" value={newProfile.level} maxLength={80} onChange={e => setNewProfile({ ...newProfile, level: e.target.value })} /></label>
            <button type="submit" disabled={busy || !newProfile.name.trim() || !newProfile.subject.trim() || !newProfile.level.trim()}>Create course</button>
          </form>
        )}

        {view === 'courses' && profiles.length === 0 && (
          <p className="supporting-text">No courses yet. Create one under New course.</p>
        )}

        {view === 'courses' && profiles.length > 0 && (
          <div className="library-course">
            <label htmlFor="library-select">Course
              <select id="library-select" value={selected ?? ''} onChange={e => setSelected(e.target.value || null)}>
                {profiles.map(profile => <option key={profile.profileId} value={profile.profileId}>{profile.name} ({profile.subject}, {profile.level})</option>)}
              </select>
            </label>
            <button type="button" className="secondary" disabled={busy || !selected} onClick={() => { void removeProfile(); }}>Delete course</button>
          </div>
        )}

        {view === 'courses' && selected && details && (
          <>
            <ul className="library-documents" aria-label="Course materials">
              {details.documents.length === 0 && <li className="supporting-text">No materials yet.</li>}
              {details.documents.map(document => (
                <li key={document.docId}>
                  <span className="library-doc-title">{document.title}</span>
                  <span className="library-doc-meta">{KINDS.find(k => k.value === document.kind)?.label ?? document.kind}{document.pages ? ` · ${document.pages} pages` : ''}</span>
                  <span role="status" className={`library-doc-status library-doc-${document.status}`}>{document.status === 'failed' && document.error ? `Indexing failed: ${document.error}` : STATUS_TEXT[document.status]}</span>
                  <button type="button" className="secondary" disabled={busy} onClick={() => { void removeDocument(document.docId); }}>Remove</button>
                </li>
              ))}
            </ul>
            <form onSubmit={e => { void addDocument(e); }} aria-label="Add material" className="library-add">
              <h4>Add material</h4>
              <label htmlFor="library-doc-title">Title<input id="library-doc-title" type="text" value={newDocument.title} maxLength={300} onChange={e => setNewDocument({ ...newDocument, title: e.target.value })} /></label>
              <label htmlFor="library-doc-kind">Kind
                <select id="library-doc-kind" value={newDocument.kind} onChange={e => setNewDocument({ ...newDocument, kind: e.target.value as DocumentKind })}>
                  {KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                </select>
              </label>
              <label htmlFor="library-doc-file">File (PDF only)<input id="library-doc-file" ref={fileInput} type="file" accept="application/pdf,.pdf" onChange={e => setNewDocument({ ...newDocument, file: e.target.files?.[0] ?? null })} /></label>
              <button type="submit" disabled={busy || !newDocument.file || !newDocument.title.trim()}>Add to course</button>
            </form>
          </>
        )}
      </div>

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
