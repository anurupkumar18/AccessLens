import React, { useCallback, useEffect, useRef, useState } from 'react';
import { courseMediaApi, displayCode, statusText, type ClassList, type CourseMediaApi, type InstructorClass, type Item } from './api';
import { MaterialViewer } from './MaterialViewer';
import { loadInstructorClasses, loadStudentCodes, saveInstructorClass, saveStudentCode } from './storage';

const POLL_MS = 4000;
const done = (item: Item) => item.status === 'ready' || item.status === 'failed';

/** Re-fetches a class while anything in it is still being processed. */
function useClassList(api: CourseMediaApi, classCode: string | null, idleMs: number) {
  const [list, setList] = useState<ClassList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!classCode) return;
    try {
      setList(await api.list(classCode));
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Could not load this class.');
    }
  }, [api, classCode]);

  useEffect(() => {
    setList(null);
    setError(null);
    void refresh();
  }, [refresh]);

  const busy = list?.items.some(item => !done(item)) ?? false;
  useEffect(() => {
    if (!classCode) return;
    const timer = setInterval(() => void refresh(), busy ? POLL_MS : idleMs);
    return () => clearInterval(timer);
  }, [classCode, busy, idleMs, refresh]);

  return { list, error, refresh };
}

// ---- Professor ----------------------------------------------------------------

interface Uploading { key: string; fileName: string; fraction: number; error?: string }

export function InstructorMaterials({ api = courseMediaApi }: { api?: CourseMediaApi }): React.ReactElement {
  const [classes, setClasses] = useState<InstructorClass[] | null>(null);
  const [active, setActive] = useState<InstructorClass | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const nextKey = useRef(0);
  const { list, error, refresh } = useClassList(api, active?.classCode ?? null, 30_000);

  useEffect(() => {
    void loadInstructorClasses().then(saved => {
      setClasses(saved);
      setActive(saved[0] ?? null);
    });
  }, []);

  async function createClass(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const cls = await api.createClass(title.trim());
      setClasses(await saveInstructorClass(cls));
      setActive(cls);
      setTitle('');
    } catch (e) {
      setCreateError((e as Error).message || 'Could not create the class.');
    } finally {
      setCreating(false);
    }
  }

  function uploadFiles(files: File[]): void {
    if (!active) return;
    for (const file of files) {
      const key = `u${nextKey.current++}`;
      setUploads(u => [...u, { key, fileName: file.name, fraction: 0 }]);
      api.upload(active, file, fraction => setUploads(u => u.map(x => (x.key === key ? { ...x, fraction } : x))))
        .then(async () => {
          setUploads(u => u.filter(x => x.key !== key));
          await refresh();
        })
        .catch(e => setUploads(u => u.map(x => (x.key === key ? { ...x, error: (e as Error).message } : x))));
    }
  }

  if (classes === null) return <p role="status">Loading…</p>;

  if (preview && active) {
    return <MaterialViewer api={api} classCode={active.classCode} itemId={preview} onBack={() => setPreview(null)} />;
  }

  return (
    <section aria-labelledby="materials-heading" className="course-materials">
      <h2 id="materials-heading">Course materials</h2>
      <p className="supporting-text">
        Upload slides, PDFs, documents, images, or recordings. Alt text and captions are added automatically, and students
        with your class code see them in AccessLens. Nothing to review.
      </p>

      {active && (
        <div className="class-card">
          <p className="eyebrow">{active.title}</p>
          <p className="class-code">
            Students enter <code aria-label={`Class code ${active.classCode.split('').join(' ')}`}>{displayCode(active.classCode)}</code>
          </p>
          <button type="button" className="quiet" onClick={() => void navigator.clipboard?.writeText(displayCode(active.classCode))}>Copy code</button>
          {classes.length > 1 && (
            <p>
              <label htmlFor="class-switch">Class</label>
              <select id="class-switch" value={active.classCode} onChange={e => setActive(classes.find(c => c.classCode === e.target.value) ?? active)}>
                {classes.map(c => <option key={c.classCode} value={c.classCode}>{c.title} ({displayCode(c.classCode)})</option>)}
              </select>
            </p>
          )}
        </div>
      )}

      <details className="new-class" open={!active}>
        <summary>{active ? 'Create another class' : 'Create your class'}</summary>
        <form onSubmit={e => void createClass(e)}>
          <label htmlFor="class-title">Class name</label>
          <input id="class-title" type="text" value={title} placeholder="e.g. BIOL 1210 Cell Biology" onChange={e => setTitle(e.target.value)} />
          <button type="submit" className="primary" disabled={creating}>{creating ? 'Creating…' : 'Create class'}</button>
          {createError && <p role="alert">{createError}</p>}
        </form>
      </details>

      {active && (
        <>
          <label
            htmlFor="materials-upload"
            className={`drop-zone${dragging ? ' dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); uploadFiles(Array.from(e.dataTransfer.files)); }}
          >
            <strong>Drop files here or choose files</strong>
            <span className="supporting-text">PowerPoint, PDF, Word, images, audio, and video</span>
          </label>
          <input id="materials-upload" className="visually-hidden-file" type="file" multiple
            onChange={e => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

          <ul className="material-list" aria-label="Uploads in progress">
            {uploads.map(u => (
              <li key={u.key} data-status={u.error ? 'failed' : 'uploading'}>
                <span className="material-name">{u.fileName}</span>
                {u.error
                  ? <span role="alert">{u.error}</span>
                  : <progress max={1} value={u.fraction} aria-label={`Uploading ${u.fileName}`}>{Math.round(u.fraction * 100)}%</progress>}
              </li>
            ))}
          </ul>

          {error && <p role="alert">{error}</p>}
          <ul className="material-list" aria-label="Materials" aria-live="polite">
            {list?.items.map(item => (
              <li key={item.itemId} data-status={item.status}>
                <span className="material-name">{item.fileName}</span>
                <span className="material-status">{statusText(item)}</span>
                <span className="material-actions">
                  {item.status === 'ready' && <button type="button" className="quiet" onClick={() => setPreview(item.itemId)}>View as student</button>}
                  <button type="button" className="quiet" onClick={() => void api.remove(active, item.itemId).then(refresh)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
          {list && list.items.length === 0 && uploads.length === 0 && <p className="supporting-text">No materials yet.</p>}
        </>
      )}
    </section>
  );
}

// ---- Student --------------------------------------------------------------------

export function StudentMaterials({ api = courseMediaApi }: { api?: CourseMediaApi }): React.ReactElement {
  const [codes, setCodes] = useState<string[]>([]);
  const [classCode, setClassCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { list, error } = useClassList(api, classCode, 60_000);

  useEffect(() => {
    void loadStudentCodes().then(saved => {
      setCodes(saved);
      setClassCode(saved[0] ?? null);
    });
  }, []);

  useEffect(() => {
    if (list && classCode) void saveStudentCode(classCode).then(setCodes);
  }, [list, classCode]);

  if (open && classCode) return <MaterialViewer api={api} classCode={classCode} itemId={open} onBack={() => setOpen(null)} />;

  const ready = list?.items.filter(item => item.status === 'ready') ?? [];
  const pending = list?.items.filter(item => item.status !== 'ready' && item.status !== 'failed') ?? [];

  return (
    <section aria-labelledby="student-materials-heading" className="course-materials">
      <h2 id="student-materials-heading">Course materials</h2>
      <form className="join-form" onSubmit={e => { e.preventDefault(); const code = typed.replace(/[\s-]/g, '').toUpperCase(); if (code) setClassCode(code); setTyped(''); }}>
        <label htmlFor="materials-code">Class code from your professor</label>
        <div>
          <input id="materials-code" className="join-code" value={typed} placeholder="e.g. ABCD-2345" autoComplete="off" spellCheck={false}
            onChange={e => setTyped(e.target.value.toUpperCase())} />
          <button type="submit">Open</button>
        </div>
      </form>
      {codes.length > 1 && (
        <p>
          <label htmlFor="materials-class">Your classes</label>
          <select id="materials-class" value={classCode ?? ''} onChange={e => setClassCode(e.target.value)}>
            {codes.map(code => <option key={code} value={code}>{displayCode(code)}</option>)}
          </select>
        </p>
      )}

      {error && <p role="alert">{error}</p>}
      {list && (
        <>
          <h3>{list.title}</h3>
          {ready.length === 0 && pending.length === 0 && <p className="supporting-text">Your professor has not added materials yet.</p>}
          <ul className="material-list" aria-label={`Materials for ${list.title}`}>
            {ready.map(item => (
              <li key={item.itemId}>
                <button type="button" className="material-open" onClick={() => setOpen(item.itemId)}>
                  <span className="material-name">{item.fileName}</span>
                  <span className="material-status">{item.kind === 'media' ? 'Captioned recording' : item.kind === 'image' ? 'Image with description' : 'Document with alt text'}</span>
                </button>
              </li>
            ))}
            {pending.map(item => (
              <li key={item.itemId} data-status={item.status}>
                <span className="material-name">{item.fileName}</span>
                <span className="material-status">Being prepared…</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
