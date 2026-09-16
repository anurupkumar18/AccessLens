import React, { useCallback, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { ServiceUnavailable, callService } from './endpoints';

/**
 * Reviewed text, in the student's language, spoken aloud.
 *
 * This is the one AI feature in the product that costs the core promise
 * nothing. The input is content an instructor already reviewed and approved;
 * translation *transforms* approved meaning rather than inventing new meaning.
 * So it is labelled "translated from your instructor's reviewed material",
 * not "AI-generated" — a distinction that matters, because a student deciding
 * whether to trust a sentence should be told which kind it is.
 *
 * Audio is played rather than downloaded. For a student whose reading is the
 * bottleneck, a file to open later is not help; help is hearing it now.
 */

interface Props {
  /** Reviewed text for the region the instructor is currently on. */
  text: string;
  reducedMotion: boolean;
}

interface TranslateResponse {
  translatedText: string;
  sourceLang?: string;
  targetLang: string;
  notice?: string;
  audioBase64?: string;
  contentType?: string;
  voiceId?: string;
  voiceEngine?: string;
  /** Translation succeeded but speech did not; the text is still usable. */
  speechUnavailable?: boolean;
}

// Kept short on purpose. A long list is a worse experience than a good short
// one, and these cover the languages most represented in US university
// classrooms. The service accepts any code Translate supports, so extending
// this is a one-line change when someone asks for their language.
const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
];

export function TranslatePanel({ text, reducedMotion }: Props): React.ReactElement {
  const [lang, setLang] = useState('es');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [message, setMessage] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const translate = useCallback(
    async (speak: boolean) => {
      if (!text.trim()) {
        setMessage('There is nothing to translate yet — wait for the instructor to move to a topic.');
        return;
      }
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setBusy(true);
      setMessage(speak ? 'Translating and reading aloud…' : 'Translating…');

      try {
        const response = await callService<TranslateResponse>(
          'translate',
          { text, targetLang: lang, speak },
          controller.signal,
        );
        setResult(response);
        setMessage('Ready.');

        if (speak && response.speechUnavailable) {
          // A correct translation is still worth showing; only the audio failed.
          setMessage('Translated. Speech is unavailable for this language right now.');
        }

        if (speak && response.audioBase64) {
          audioRef.current?.pause();
          const audio = new Audio(
            `data:${response.contentType ?? 'audio/mpeg'};base64,${response.audioBase64}`,
          );
          audioRef.current = audio;
          // Autoplay can be refused; the text is already on screen, so a
          // refusal degrades rather than fails.
          void audio.play().catch(() => setMessage('Translated. Your browser blocked autoplay — press Read aloud again.'));
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        setMessage(
          error instanceof ServiceUnavailable ? error.message : 'Could not translate just now.',
        );
      } finally {
        setBusy(false);
      }
    },
    [lang, text],
  );

  return (
    <section className="a11y-card" aria-labelledby="translate-heading">
      <h3 id="translate-heading">Read this in your language</h3>
      <p className="supporting-text">
        Translates what your instructor already wrote and approved — not a new explanation.
      </p>

      <div className="a11y-actions">
        <label className="a11y-field">
          <span>Language</span>
          <select value={lang} onChange={(event) => setLang(event.target.value)} disabled={busy}>
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void translate(false)} disabled={busy}>
          Translate
        </button>
        <button type="button" onClick={() => void translate(true)} disabled={busy}>
          Translate &amp; read aloud
        </button>
        {busy && !reducedMotion ? (
          <span aria-hidden="true" className="a11y-orb">
            <ThinkingOrb state="weaving" size={20} />
          </span>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="supporting-text">
        {message}
      </p>

      {result ? (
        <div className="a11y-result">
          <p className="a11y-notice a11y-notice--reviewed">
            <strong>Source:</strong>{' '}
            {result.notice ?? 'Machine-translated from your instructor’s reviewed material.'}
          </p>
          {/* lang tells a screen reader to switch voices; without it the text
              is read with English phonetics and is close to unusable. */}
          <p lang={result.targetLang}>{result.translatedText}</p>
        </div>
      ) : null}
    </section>
  );
}
