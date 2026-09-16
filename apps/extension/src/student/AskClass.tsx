import React, { useState } from 'react';
import type { AccessPack, RoleCapability } from '../shared/contracts';
import { AiUnavailableError, isRelayCapability, type AiClient, type AskAnswer } from '../shared/aiClient';
import { savePrivateClassTask } from './classTasks';

const DECLINE_MESSAGES: Record<string, string> = {
  'no-reviewed-material': "This lesson's reviewed material doesn't cover that. Try asking about something on the slides.",
  'not-supported-by-material': "The reviewed lesson material doesn't answer that, so there's no answer rather than a guess.",
  'question-invalid': 'Ask a question between 3 and 300 characters.',
  'model-unavailable': 'The answer service is busy right now. Try again in a moment.',
};

interface Props {
  pack: AccessPack;
  capability: RoleCapability | null;
  ai: AiClient | null;
}

/**
 * "Ask this class": a question answered only from this class's reviewed
 * Access Pack, with the parts of the lesson it came from. Declines instead of
 * guessing. The question is sent to answer it and is not stored.
 */
export function AskClass({ pack, capability, ai }: Props): React.ReactElement {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskSaved, setTaskSaved] = useState(false);
  const available = ai !== null && isRelayCapability(capability);

  async function ask(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!ai || !isRelayCapability(capability) || !question.trim()) return;
    setPending(true);
    setError(null);
    setResult(null);
    setTaskSaved(false);
    try {
      setResult(await ai.ask(capability, pack.packId, pack.version, question.trim()));
    } catch (caught) {
      setError(caught instanceof AiUnavailableError && caught.status === 404
        ? 'Questions are only answered from reviewed lesson packs, and this one has not been reviewed yet.'
        : 'Could not get an answer right now. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  function saveAsTask(): void {
    if (result?.status !== 'answered') return;
    savePrivateClassTask({
      question: question.trim(),
      answer: result.answer,
      sources: result.citations.map(citation => `${citation.label} (${citation.assetTitle})`),
    });
    setTaskSaved(true);
  }

  return (
    <section className="ask-class" aria-labelledby="ask-class-title">
      <h3 id="ask-class-title">Ask this class</h3>
      <p className="supporting-text">Answers come from Claude on Amazon Bedrock, using only this lesson's reviewed material. Your question is not saved.</p>
      {available ? (
        <form onSubmit={submitEvent => { void ask(submitEvent); }}>
          <label htmlFor="ask-question">Your question about the lesson</label>
          <div className="ask-row">
            <input id="ask-question" type="text" maxLength={300} value={question} onChange={changeEvent => setQuestion(changeEvent.target.value)} placeholder="e.g. What does the mitochondrion do?" />
            <button type="submit" className="primary" disabled={pending || question.trim().length < 3}>{pending ? 'Asking…' : 'Ask'}</button>
          </div>
        </form>
      ) : (
        <p className="notice">Join a live session with its code to ask questions about the lesson.</p>
      )}
      <div role="status" aria-live="polite">
        {error ? <p className="answer declined">{error}</p> : null}
        {result?.status === 'answered' ? (
          <div className="answer">
            <p>{result.answer}</p>
            <p className="answer-sources">
              <span className="eyebrow">From the reviewed lesson</span>
              {result.citations.map(citation => `${citation.label} (${citation.assetTitle})`).join(' · ')}
            </p>
            <button type="button" className="secondary" onClick={saveAsTask} disabled={taskSaved}>
              {taskSaved ? 'Saved privately on this device' : 'Add as a private task'}
            </button>
          </div>
        ) : null}
        {result?.status === 'declined' ? <p className="answer declined">{DECLINE_MESSAGES[result.reason] ?? DECLINE_MESSAGES['not-supported-by-material']}</p> : null}
      </div>
    </section>
  );
}
