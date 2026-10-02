import { describe, expect, test } from 'bun:test';
import { maskCredentialName, maskEmail } from '@/features/quota/credentialMask';

describe('maskEmail', () => {
  test('keeps the first character of the local part and domain, and the TLD', () => {
    expect(maskEmail('theo@t3.gg')).toBe('t•••@t•••.gg');
    expect(maskEmail('jf@1password.dev')).toBe('j•••@1•••.dev');
    expect(maskEmail('a.b@mail.example.co.uk')).toBe('a•••@m•••.uk');
  });

  test('masks degenerate input without throwing', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('nobody')).toBe('n•••');
    expect(maskEmail('user@localhost')).toBe('u•••@l•••');
  });
});

describe('maskCredentialName', () => {
  test('matches the screenshot shape for legacy Claude names', () => {
    expect(maskCredentialName('claude-theo@1password.dev.json')).toBe('claude-t•••@1•••.dev.json');
    expect(maskCredentialName('claude-theo@ping.gg.json')).toBe('claude-t•••@p•••.gg.json');
  });

  test('keeps the hash prefix and plan suffix of current backend names', () => {
    expect(maskCredentialName('claude-abc12345-user@example.com.json')).toBe(
      'claude-abc12345-u•••@e•••.com.json'
    );
    expect(maskCredentialName('codex-abc12345-user@example.com-team-plan.json')).toBe(
      'codex-abc12345-u•••@e•••.com-team-plan.json'
    );
  });

  test('uses the auth file email to mask a hyphenated local part whole', () => {
    // By pattern alone the hyphen splits the local part and leaks "first-".
    expect(maskCredentialName('claude-first-last@example.com.json')).toBe(
      'claude-first-l•••@e•••.com.json'
    );
    expect(maskCredentialName('claude-first-last@example.com.json', 'first-last@example.com')).toBe(
      'claude-f•••@e•••.com.json'
    );
  });

  test('matches the auth file email case-insensitively', () => {
    expect(maskCredentialName('xai-Theo@T3.gg.json', 'theo@t3.gg')).toBe('xai-t•••@t•••.gg.json');
  });

  test('leaves names without an email untouched', () => {
    expect(maskCredentialName('kimi-3f9a2c.json')).toBe('kimi-3f9a2c.json');
    expect(maskCredentialName('vertex-my-project.json', '')).toBe('vertex-my-project.json');
  });

  test('masks the identity suffix of a Devin display name', () => {
    expect(maskCredentialName('devin-1.json · dev@example.org')).toBe(
      'devin-1.json · d•••@e•••.org'
    );
  });

  test('never re-masks an already masked name', () => {
    const once = maskCredentialName('claude-theo@t3.gg.json', 'theo@t3.gg');
    expect(maskCredentialName(once, 'theo@t3.gg')).toBe(once);
  });
});
