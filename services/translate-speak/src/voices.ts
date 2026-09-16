/**
 * Polly voice selection. Pure, AWS-free, and deliberately data-first.
 *
 * Voice choice is the one part of this service that has to be *correct offline*.
 * A wrong voice id is not a soft failure: Polly rejects the whole
 * `SynthesizeSpeech` call, so the student gets silence instead of a slightly
 * off accent. That makes the table below the thing worth testing, and it is why
 * nothing in this file imports an SDK — the tests can assert every entry without
 * credentials, a region, or a network.
 *
 * Two facts are tracked per voice: which locale it speaks, and whether Polly's
 * `neural` engine supports it. The second one matters because neural is not a
 * quality dial you can always turn up — Polly errors out if you ask for `neural`
 * on a standard-only voice. Russian (`Tatyana`) and generic Arabic (`Zeina`) are
 * standard-only today, so "just always use neural" is not an option and the
 * caller has to be told which engine it actually got.
 */

/** A voice this service knows how to ask for. */
export interface PickedVoice {
  /** Polly `VoiceId` — passed to `SynthesizeSpeechCommand` verbatim. */
  voiceId: string;
  /** Polly `LanguageCode` for the voice. Informational: reported to the caller. */
  languageCode: string;
  /** Whether Polly's `neural` engine supports this voice. */
  supportsNeural: boolean;
}

/**
 * The voices this service is willing to name, and what Polly supports for each.
 *
 * Kept as a registry rather than inlined into the language map so that an
 * explicitly *requested* voice can be resolved to the right engine too. Without
 * this, an instructor asking for `Tatyana` would get a neural request and a
 * hard failure.
 */
const VOICES: Record<string, Omit<PickedVoice, 'voiceId'>> = {
  // English
  Joanna: { languageCode: 'en-US', supportsNeural: true },
  Matthew: { languageCode: 'en-US', supportsNeural: true },
  Amy: { languageCode: 'en-GB', supportsNeural: true },
  // Spanish
  Lucia: { languageCode: 'es-ES', supportsNeural: true },
  Mia: { languageCode: 'es-MX', supportsNeural: true },
  // French
  Lea: { languageCode: 'fr-FR', supportsNeural: true },
  // German
  Vicki: { languageCode: 'de-DE', supportsNeural: true },
  // Portuguese
  Camila: { languageCode: 'pt-BR', supportsNeural: true },
  // Italian
  Bianca: { languageCode: 'it-IT', supportsNeural: true },
  // Mandarin Chinese
  Zhiyu: { languageCode: 'cmn-CN', supportsNeural: true },
  // Japanese
  Takumi: { languageCode: 'ja-JP', supportsNeural: true },
  // Korean
  Seoyeon: { languageCode: 'ko-KR', supportsNeural: true },
  // Hindi. Kajal is neural-only; Aditi is the standard-engine voice, kept so a
  // caller who explicitly asks for it is not sent down the neural path.
  Kajal: { languageCode: 'hi-IN', supportsNeural: true },
  Aditi: { languageCode: 'hi-IN', supportsNeural: false },
  // Arabic. `Zeina` speaks Modern Standard Arabic (`arb`) and has no neural
  // build; `Hala` is Gulf Arabic and is neural-only.
  Zeina: { languageCode: 'arb', supportsNeural: false },
  Hala: { languageCode: 'ar-AE', supportsNeural: true },
  // Russian — Polly has no neural Russian voice, so both entries are standard.
  Tatyana: { languageCode: 'ru-RU', supportsNeural: false },
  Maxim: { languageCode: 'ru-RU', supportsNeural: false },
};

/** Default voice per base language subtag (the part before the first `-`). */
const BY_LANGUAGE: Record<string, string> = {
  en: 'Joanna',
  es: 'Lucia',
  fr: 'Lea',
  de: 'Vicki',
  pt: 'Camila',
  it: 'Bianca',
  zh: 'Zhiyu',
  ja: 'Takumi',
  ko: 'Seoyeon',
  hi: 'Kajal',
  ar: 'Zeina',
  ru: 'Tatyana',
};

/**
 * Locale-specific overrides, consulted before {@link BY_LANGUAGE}.
 *
 * A Mexican student asking for `es-MX` and getting a Castilian voice is a
 * comprehensible but jarring result, and the fix costs one table entry.
 */
const BY_LOCALE: Record<string, string> = {
  'es-mx': 'Mia',
  'es-us': 'Mia',
  'en-gb': 'Amy',
  'ar-ae': 'Hala',
};

/** Used when the requested language has no voice at all. */
const FALLBACK_VOICE = 'Joanna';

/**
 * Reduce a BCP-47-ish tag to `language` and `language-region` lookup keys.
 *
 * Callers send whatever the browser or a course setting handed them: `ES`,
 * `es_MX`, `zh-Hans-CN`. Normalising here keeps every table above lowercase and
 * two-part, instead of each one growing spelling variants.
 */
function lookupKeys(tag: string): { base: string; locale: string } {
  const parts = tag.trim().toLowerCase().replace(/_/g, '-').split('-');
  const base = parts[0] ?? '';
  // Skip script subtags (`Hans`, `Latn`): a region subtag is 2 letters or 3
  // digits, so anything else between language and region is not the region.
  const region = parts.slice(1).find((part) => /^([a-z]{2}|\d{3})$/.test(part)) ?? '';
  return { base, locale: region ? `${base}-${region}` : base };
}

/**
 * Choose a Polly voice for a target language.
 *
 * An explicit `requested` voice always wins — that is an instructor or course
 * setting deliberately overriding the default, and silently ignoring it would
 * make the setting look broken. An unrecognised language falls back to English
 * rather than throwing: the translation itself has already succeeded at that
 * point, and returning translated text with an odd accent is strictly better
 * than returning a 502 for text the student could have heard.
 */
export function pickVoice(targetLang: string, requested?: string): PickedVoice {
  const explicit = requested?.trim();
  if (explicit) {
    const known = VOICES[explicit];
    if (known) return { voiceId: explicit, ...known };
    // A voice id this service has never heard of. Honour it anyway (Polly adds
    // voices faster than this table is updated) but assume standard: guessing
    // neural on an unknown voice turns a working request into a failed one,
    // while guessing standard at worst costs some prosody.
    const { locale } = lookupKeys(targetLang);
    return { voiceId: explicit, languageCode: locale, supportsNeural: false };
  }

  const { base, locale } = lookupKeys(targetLang);
  const voiceId = BY_LOCALE[locale] ?? BY_LANGUAGE[base] ?? FALLBACK_VOICE;
  const entry = VOICES[voiceId] ?? VOICES[FALLBACK_VOICE];
  // `FALLBACK_VOICE` is a literal key of `VOICES`, so this branch is unreachable
  // in practice; it exists to satisfy `noUncheckedIndexedAccess` without a cast.
  if (!entry) return { voiceId: FALLBACK_VOICE, languageCode: 'en-US', supportsNeural: true };
  return { voiceId, ...entry };
}

/** Every language code {@link pickVoice} has a non-fallback answer for. */
export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(BY_LANGUAGE);

/** Exported so a test can assert the registry and the language map agree. */
export const KNOWN_VOICE_IDS: readonly string[] = Object.keys(VOICES);
