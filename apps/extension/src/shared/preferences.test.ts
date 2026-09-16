import {describe,it,expect,beforeEach} from 'vitest';
import {StudentPreferencesSchema, defaultPreferences, loadPreferences, savePreferences, resetPreferencesForTests} from './preferences';

describe('StudentPreferencesSchema', () => {
  it('accepts the default preferences', () => {
    expect(StudentPreferencesSchema.safeParse(defaultPreferences).success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    expect(StudentPreferencesSchema.safeParse({...defaultPreferences, mode:'video-call'}).success).toBe(false);
  });

  it.each(['studentId','studentName','email','diagnosis','disability','grade','mastery','attentionScore','gazeVector','rawFrame'])(
    'rejects a %s field',
    (field) => {
      expect(StudentPreferencesSchema.safeParse({...defaultPreferences, [field]:'x'}).success).toBe(false);
    }
  );
});

describe('local preferences storage', () => {
  beforeEach(() => resetPreferencesForTests());

  it('falls back to defaults when nothing has been saved', async () => {
    expect(await loadPreferences()).toEqual(defaultPreferences);
  });

  it('round-trips saved preferences without any network or session client', async () => {
    const changed = {...defaultPreferences, mode:'dyslexic' as const, reducedMotion:true};
    await savePreferences(changed);
    expect(await loadPreferences()).toEqual(changed);
  });

  it('starts from the defaults when a saved mode is no longer offered', async () => {
    await savePreferences(defaultPreferences);
    // Written by an earlier build that still had a spoken mode.
    await savePreferences({...defaultPreferences, mode: 'audio'} as never).catch(() => undefined);
    expect(await loadPreferences()).toEqual(defaultPreferences);
  });

  it('rejects saving preferences with a prohibited field', async () => {
    await expect(savePreferences({...defaultPreferences, diagnosis:'adhd'} as never)).rejects.toThrow();
  });
});
