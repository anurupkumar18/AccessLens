import {describe,it,expect,beforeEach} from 'vitest';
import {StudentPreferencesSchema, defaultPreferences, loadPreferences, savePreferences, resetPreferencesForTests} from './preferences';
import { LiveEventSchema } from './contracts';
import { validEvent } from './fixtures';

describe('StudentPreferencesSchema', () => {
  it('accepts the default preferences', () => {
    expect(StudentPreferencesSchema.safeParse(defaultPreferences).success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(StudentPreferencesSchema.safeParse({...defaultPreferences, mode:'video-call'}).success).toBe(false);
  });

  it('fills safe reading-control defaults for an existing stored preference', () => {
    const legacyPreference = {
      schemaVersion: '1.0', mode: 'focus', textScale: 1,
      reducedMotion: false, captionsEnabled: true,
    };
    expect(StudentPreferencesSchema.parse(legacyPreference)).toEqual(defaultPreferences);
  });

  it.each([
    ['fontFamily', 'handwriting'],
    ['lineSpacing', 'double-plus'],
    ['contentWidth', 'unbounded'],
    ['speechRate', 2],
  ])('rejects an invalid %s preference', (field, value) => {
    expect(StudentPreferencesSchema.safeParse({...defaultPreferences, [field]: value}).success).toBe(false);
  });

  it.each(['studentId','studentName','email','diagnosis','disability','grade','mastery','attentionScore','gazeVector','rawFrame'])(
    'rejects a %s field',
    (field) => {
      expect(StudentPreferencesSchema.safeParse({...defaultPreferences, [field]:'x'}).success).toBe(false);
    }
  );

  it('does not permit a local preference in a live event', () => {
    expect(LiveEventSchema.safeParse({...validEvent, fontFamily: 'serif'}).success).toBe(false);
  });
});

describe('local preferences storage', () => {
  beforeEach(() => resetPreferencesForTests());

  it('falls back to defaults when nothing has been saved', async () => {
    expect(await loadPreferences()).toEqual(defaultPreferences);
  });

  it('round-trips saved preferences without any network or session client', async () => {
    const changed = {
      ...defaultPreferences,
      mode:'audio' as const,
      fontFamily: 'serif' as const,
      lineSpacing: 'spacious' as const,
      contentWidth: 'narrow' as const,
      highContrast: true,
      speechRate: 1.25,
      reducedMotion:true,
    };
    await savePreferences(changed);
    expect(await loadPreferences()).toEqual(changed);
  });

  it('rejects saving preferences with a prohibited field', async () => {
    await expect(savePreferences({...defaultPreferences, diagnosis:'adhd'} as never)).rejects.toThrow();
  });
});
