import React, { useEffect, useRef, useState } from 'react';
import { AuthoringApiError } from '../shared/authoringClient';
import { classroomApiUrl, createClassroomClient, type ClassroomClient, type CourseAskResult, type CourseMembership } from '../shared/classroomClient';
import { extensionIdentity, googleClientId, readSession, renderGoogleButton, signInWithExtension, writeSession, type GoogleSession } from '../shared/googleSignIn';
import { listPrivateClassTasks, removePrivateClassTask, savePrivateClassTask, type PrivateClassTask } from './classTasks';

interface Props {
  client?: ClassroomClient;
  apiUrl?: string | null;
  clientId?: string | null;
  signIn?: () => Promise<GoogleSession>;
}

const ENROLLMENT_KEY = 'accesslens.classroom.enrollment.v1';
const SESSION_KEY = 'accesslens.classroom.session';

function readEnrollment(): CourseMembership | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(ENROLLMENT_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    return typeof record.profileId === 'string' && typeof record.studentSub === 'string' && record.role === 'student' && typeof record.joinedAt === 'string'
      ? record as CourseMembership : null;
  } catch { return null; }
}

function writeEnrollment(membership: CourseMembership | null): void {
  if (membership) window.localStorage.setItem(ENROLLMENT_KEY, JSON.stringify(membership));
  else window.localStorage.removeItem(ENROLLMENT_KEY);
}

const DECLINES: Record<string, string> = {
  'course-assistant-disabled': 'This class assistant is not enabled yet.',
  'not-supported-by-material': 'The approved class materials do not support an answer, so no answer was given.',
  'class-archived': 'This class is archived and no longer available to students.',
  'model-unavailable': 'The answer service is unavailable right now. Try again later.',
};

/** A separate student course plane: Google-authenticated, class-scoped, and no chat history. */
export function CourseAssistant({ client: injected, apiUrl = classroomApiUrl, clientId = googleClientId, signIn }: Props): React.ReactElement {
  const [session, setSession] = useState<GoogleSession | null>(() => readSession(Date.now(), SESSION_KEY));
  const [membership, setMembership] = useState<CourseMembership | null>(() => readEnrollment());
  const [invite, setInvite] = useState('');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<CourseAskResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tasks, setTasks] = useState<PrivateClassTask[]>(() => listPrivateClassTasks());
  const buttonHost = useRef<HTMLDivElement>(null);
  const extensionFlow = signIn !== undefined || extensionIdentity() !== null;
  const client = injected ?? (apiUrl && session ? createClassroomClient(apiUrl, session.idToken) : null);

  function forgetSession(): void { writeSession(null, SESSION_KEY); setSession(null); }
  function refreshTasks(): void { setTasks(listPrivateClassTasks()); }

  async function startSignIn(): Promise<void> {
    if (!clientId) return;
    setMessage(null);
    try {
      const next = await (signIn ?? (() => signInWithExtension(clientId, extensionIdentity()!, SESSION_KEY)))();
      writeSession(next, SESSION_KEY); setSession(next);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Google sign-in did not complete.'); }
  }

  useEffect(() => {
    const host = buttonHost.current;
    if (extensionFlow || !clientId || session || injected || !host) return;
    void renderGoogleButton(host, clientId, next => { writeSession(next, SESSION_KEY); setSession(next); }, SESSION_KEY).catch(error => setMessage(error instanceof Error ? error.message : 'Google sign-in did not load.'));
  }, [clientId, extensionFlow, injected, session]);

  async function redeem(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!client || invite.trim().length < 16) return;
    setPending(true); setMessage(null);
    try {
      const next = await client.redeemInvite(invite.trim());
      writeEnrollment(next); setMembership(next); setInvite(''); setResult(null);
    } catch (error) {
      if (error instanceof AuthoringApiError && error.status === 401) forgetSession();
      setMessage(error instanceof Error ? error.message : 'The invite could not be redeemed.');
    } finally { setPending(false); }
  }

  async function ask(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!client || !membership || question.trim().length < 3) return;
    setPending(true); setMessage(null); setResult(null);
    try { setResult(await client.ask(membership.profileId, question.trim())); }
    catch (error) {
      if (error instanceof AuthoringApiError && error.status === 401) forgetSession();
      setMessage(error instanceof Error ? error.message : 'Could not ask the class assistant.');
    } finally { setPending(false); }
  }

  function saveTask(): void {
    if (result?.status !== 'answered') return;
    savePrivateClassTask({ question: question.trim(), answer: result.answer, sources: result.citations.map(citation => `${citation.title} (page ${citation.page})`) });
    refreshTasks();
  }

  if (!injected && (!apiUrl || !clientId)) return <section className="course-assistant" aria-labelledby="course-assistant-title"><h2 id="course-assistant-title">Class library</h2><p>This build has no class assistant or Google sign-in configured.</p></section>;

  if (!client) return (
    <section className="course-assistant" aria-labelledby="course-assistant-title">
      <h2 id="course-assistant-title">Class library</h2>
      <p className="supporting-text">Sign in to join a class and ask only about its approved materials. Questions are not saved.</p>
      {extensionFlow ? <button type="button" onClick={() => { void startSignIn(); }}>Sign in with Google</button> : <div ref={buttonHost} aria-label="Sign in with Google" />}
      {message && <p role="alert">{message}</p>}
    </section>
  );

  if (!membership) return (
    <section className="course-assistant" aria-labelledby="course-assistant-title">
      <h2 id="course-assistant-title">Join a class library</h2>
      <p className="supporting-text">Enter the private invite code your instructor shared. It creates access only to that class.</p>
      <form onSubmit={event => { void redeem(event); }} aria-label="Redeem class invite">
        <label htmlFor="class-invite">Invite code<input id="class-invite" value={invite} onChange={event => setInvite(event.target.value)} autoComplete="off" /></label>
        <button type="submit" disabled={pending || invite.trim().length < 16}>{pending ? 'Joining…' : 'Join class'}</button>
      </form>
      <button type="button" className="secondary" onClick={forgetSession}>Sign out</button>
      {message && <p role="alert">{message}</p>}
    </section>
  );

  return (
    <section className="course-assistant" aria-labelledby="course-assistant-title">
      <h2 id="course-assistant-title">Class library</h2>
      <p className="supporting-text">Answers are limited to approved materials in this class and always cite their source. Your questions are not saved.</p>
      <form onSubmit={event => { void ask(event); }} aria-label="Ask class library">
        <label htmlFor="class-question">Your question about this class</label>
        <div className="ask-row"><input id="class-question" maxLength={300} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What happened in class on September 16?" /><button type="submit" disabled={pending || question.trim().length < 3}>{pending ? 'Asking…' : 'Ask class'}</button></div>
      </form>
      {message && <p role="alert">{message}</p>}
      {result?.status === 'answered' && <div className="answer"><p>{result.answer}</p>{result.provisional && <p className="notice">Provisional — your instructor has not published this fact yet.</p>}<p className="answer-sources"><span className="eyebrow">Sources</span>{result.citations.map(citation => `${citation.title} (page ${citation.page}): “${citation.quote}”`).join(' · ')}</p><button type="button" className="secondary" onClick={saveTask}>Add as a private task</button></div>}
      {result?.status === 'declined' && <p className="answer declined">{DECLINES[result.reason]}</p>}
      <section className="private-tasks" aria-labelledby="private-tasks-title"><h3 id="private-tasks-title">Private tasks on this device</h3>{tasks.length === 0 ? <p className="supporting-text">Nothing saved yet.</p> : <ul>{tasks.map(task => <li key={task.taskId}><strong>{task.question}</strong><span>{task.answer}</span><button type="button" className="secondary" onClick={() => { removePrivateClassTask(task.taskId); refreshTasks(); }}>Remove</button></li>)}</ul>}</section>
      <button type="button" className="secondary" onClick={() => { writeEnrollment(null); setMembership(null); setResult(null); }}>Use another class</button>
      <button type="button" className="secondary" onClick={forgetSession}>Sign out</button>
    </section>
  );
}
