import React, { useEffect, useRef, useState } from 'react';
import type { AccessPack, RoleCapability } from '../shared/contracts';
import { isRelayCapability } from '../shared/aiClient';
import { ChatUnavailableError, type ChatClient, type ChatSource, type ChatStop, type ChatTurn } from '../shared/chatClient';

interface Props {
  pack: AccessPack;
  capability: RoleCapability | null;
  client: ChatClient | null;
  /** What the student is following in the live lesson, so "this slide" means something. */
  assetId?: string;
  regionId?: string;
}

interface Message {
  id: number;
  role: ChatTurn['role'];
  text: string;
  sources?: ChatSource[];
  stop?: ChatStop | 'stopped';
  error?: string;
  streaming?: boolean;
}

const MAX_CHARS = 2000;

const SUGGESTIONS = [
  'Explain this slide in simple words',
  'Give me an everyday example',
  'Quiz me on this slide',
];

const STOP_NOTES: Partial<Record<Message['stop'] & string, string>> = {
  guardrail: 'Filtered by the chat’s safety guardrail.',
  content_filtered: 'Filtered by the chat’s safety guardrail.',
  max_tokens: 'This reply was cut short. Ask it to continue.',
  search_limit: 'Stopped after searching the course files twice.',
  stopped: 'You stopped this reply.',
};

/**
 * The earlier conversation the model gets: only question-and-answer pairs that
 * completed. A blocked exchange is left out on purpose, because the guardrail
 * screens everything sent and would otherwise block every later message too;
 * failed and stopped replies are left out because they are not answers.
 */
function contextFrom(history: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  history.forEach((message, index) => {
    const reply = history[index + 1];
    if (message.role !== 'student' || reply?.role !== 'assistant') return;
    if (reply.error || reply.streaming || !reply.text || reply.stop === 'guardrail' || reply.stop === 'content_filtered' || reply.stop === 'stopped') return;
    turns.push({ role: 'student', text: message.text }, { role: 'assistant', text: reply.text });
  });
  return turns;
}

function errorText(caught: unknown): string {
  if (caught instanceof ChatUnavailableError) {
    if (caught.status === 429) return 'You are sending messages quickly. Wait a moment, then try again.';
    if (caught.status === 404) return 'The chat only works with reviewed lesson packs, and this one has not been reviewed yet.';
    if (caught.status === 401 || caught.status === 403) return 'Your class session has ended or expired. Join again with the code to keep chatting.';
  }
  return 'The study chat could not answer right now.';
}

/**
 * The student study chat: a conversation about the lesson with Claude on
 * Amazon Bedrock, screened by a Bedrock Guardrail, grounded in the reviewed
 * lesson and (once the team connects one) the instructor's course files.
 *
 * Built for students using screen readers: the streaming reply is not a live
 * region (announcing every fragment is noise), and each finished reply is
 * announced once. Enter sends, Shift+Enter adds a line, and the conversation
 * is kept only in this page: closing it forgets the chat.
 */
export function StudyChat({ pack, capability, client, assetId, regionId }: Props): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const logEnd = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const available = client !== null && isRelayCapability(capability);
  const slide = pack.assets.find(asset => asset.assetId === assetId);

  useEffect(() => { logEnd.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  function update(id: number, change: (message: Message) => Message): void {
    setMessages(current => current.map(message => (message.id === id ? change(message) : message)));
  }

  async function send(text: string, history: Message[]): Promise<void> {
    if (!client || !isRelayCapability(capability) || streaming) return;
    const question = text.trim().slice(0, MAX_CHARS);
    if (!question) return;
    const student: Message = { id: nextId.current++, role: 'student', text: question };
    const reply: Message = { id: nextId.current++, role: 'assistant', text: '', streaming: true };
    const turns = [...contextFrom(history), { role: 'student' as const, text: question }];
    setMessages([...history, student, reply]);
    setDraft('');
    setStreaming(true);
    setAnnouncement('');
    const controller = new AbortController();
    abort.current = controller;
    let written = '';
    try {
      await client.send({ capability, packId: pack.packId, packVersion: pack.version, assetId, regionId, turns }, event => {
        if (event.type === 'delta') {
          written += event.text;
          update(reply.id, message => ({ ...message, text: message.text + event.text }));
        } else if (event.type === 'sources') {
          update(reply.id, message => ({ ...message, sources: [...(message.sources ?? []), ...event.sources] }));
        } else if (event.type === 'done') {
          update(reply.id, message => ({ ...message, stop: event.stop }));
        } else {
          update(reply.id, message => ({ ...message, error: 'The study chat could not finish this reply.' }));
        }
      }, controller.signal);
      if (controller.signal.aborted) update(reply.id, message => ({ ...message, stop: 'stopped' }));
      else setAnnouncement(written ? `Study chat replied: ${written}` : '');
    } catch (caught) {
      update(reply.id, message => ({ ...message, error: errorText(caught) }));
      setAnnouncement(errorText(caught));
    } finally {
      update(reply.id, message => ({ ...message, streaming: false }));
      setStreaming(false);
      abort.current = null;
      input.current?.focus();
    }
  }

  function retry(): void {
    // Resend the last question, dropping the failed reply and the question itself (send adds it again).
    const lastStudent = [...messages].reverse().find(message => message.role === 'student');
    if (!lastStudent) return;
    void send(lastStudent.text, messages.slice(0, messages.indexOf(lastStudent)));
  }

  function newChat(): void {
    abort.current?.abort();
    setMessages([]);
    setAnnouncement('Started a new chat.');
    input.current?.focus();
  }

  return (
    <section className="study-chat" aria-labelledby="study-chat-title">
      <div className="study-chat-head">
        <h3 id="study-chat-title">Study chat</h3>
        {messages.length > 0 && <button type="button" className="quiet" onClick={newChat}>New chat</button>}
      </div>
      <p className="supporting-text">
        Chat about the lesson with Claude on Amazon Bedrock. Messages are checked by AWS guardrails, and the chat is not saved: leaving this page forgets it.
      </p>

      {!available ? (
        <p className="notice">Join your class with the code from your instructor to start chatting.</p>
      ) : (
        <>
          {slide && <p className="study-chat-context"><span className="eyebrow">Chatting about</span> {slide.title}</p>}
          <div className="study-chat-log" role="log" aria-label="Study chat conversation" aria-live="off" tabIndex={0}>
            {messages.length === 0 ? (
              <div className="study-chat-empty">
                <p>Ask anything about the lesson, or start with:</p>
                <ul className="study-chat-suggestions">
                  {SUGGESTIONS.map(suggestion => (
                    <li key={suggestion}><button type="button" onClick={() => { void send(suggestion, messages); }}>{suggestion}</button></li>
                  ))}
                </ul>
              </div>
            ) : messages.map(message => (
              <article key={message.id} className={`chat-message ${message.role}`} aria-label={message.role === 'student' ? 'You said' : 'Study chat said'}>
                <p className="chat-author" aria-hidden="true">{message.role === 'student' ? 'You' : 'Study chat'}</p>
                {message.text && <p className="chat-text">{message.text}</p>}
                {message.streaming && !message.text && <p className="chat-typing">Thinking…</p>}
                {message.sources && message.sources.length > 0 && (
                  <div className="chat-sources">
                    <p className="eyebrow">From your course files</p>
                    <ul>{message.sources.map(source => <li key={source.id}>{source.title}</li>)}</ul>
                  </div>
                )}
                {message.stop && STOP_NOTES[message.stop] && <p className="chat-note">{STOP_NOTES[message.stop]}</p>}
                {message.error && (
                  <p className="chat-note error">
                    {message.error}{' '}
                    {message === messages.at(-1) && !streaming && <button type="button" className="quiet" onClick={retry}>Try again</button>}
                  </p>
                )}
              </article>
            ))}
            <div ref={logEnd} />
          </div>
          <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>

          <form className="study-chat-form" onSubmit={submitEvent => { submitEvent.preventDefault(); void send(draft, messages); }}>
            <label htmlFor="study-chat-input">Message the study chat</label>
            <textarea
              id="study-chat-input"
              ref={input}
              rows={2}
              maxLength={MAX_CHARS}
              value={draft}
              aria-describedby="study-chat-hint"
              onChange={changeEvent => setDraft(changeEvent.target.value)}
              onKeyDown={keyEvent => {
                if (keyEvent.key === 'Enter' && !keyEvent.shiftKey && !keyEvent.nativeEvent.isComposing) {
                  keyEvent.preventDefault();
                  void send(draft, messages);
                }
              }}
            />
            <div className="study-chat-actions">
              <p id="study-chat-hint" className="supporting-text">Enter to send, Shift+Enter for a new line. {draft.length > MAX_CHARS - 200 ? `${MAX_CHARS - draft.length} characters left.` : ''}</p>
              {streaming
                ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
                : <button type="submit" className="primary" disabled={!draft.trim()}>Send</button>}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
