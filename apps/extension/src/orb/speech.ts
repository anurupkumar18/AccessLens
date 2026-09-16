/**
 * Text to speech through the browser's own voices.
 *
 * Deliberately not a cloud service. Polly would sound better, but speech here
 * is the primary access route for some students, and a route that needs a
 * network round trip, an API key, and a working backend is a route that fails
 * exactly when the room's wifi does. The Web Speech API ships with the
 * browser, costs nothing, and works offline.
 */

export interface Speaker {
  speak(text: string): void;
  stop(): void;
  readonly available: boolean;
  readonly speaking: boolean;
}

export function createSpeaker(): Speaker {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  let current: SpeechSynthesisUtterance | undefined;

  return {
    get available() {
      return Boolean(synth);
    },
    get speaking() {
      return Boolean(synth?.speaking);
    },
    speak(text: string) {
      if (!synth || !text.trim()) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      // Slightly slower than default: this is explanatory content, often being
      // heard by someone who is also reading along.
      utterance.rate = 0.95;
      utterance.lang = document.documentElement.lang || 'en';
      current = utterance;
      synth.speak(utterance);
    },
    stop() {
      synth?.cancel();
      current = undefined;
    },
  };
}
