import { describe, expect, it } from 'vitest';
import { parseSecretLines, SecretSyntaxError } from './secrets';

describe('parseSecretLines', () => {
  it('reads one credential per line', () => {
    expect(parseSecretLines('CLIENT_ID=abc\nCLIENT_SECRET=def')).toEqual({
      CLIENT_ID: 'abc',
      CLIENT_SECRET: 'def',
    });
  });

  it('ignores blank lines and comments, and trims around the separator', () => {
    const text = ['# raccordement de recette', '', '  API_KEY  =  k-123  ', ''].join('\n');
    expect(parseSecretLines(text)).toEqual({ API_KEY: 'k-123' });
  });

  it('keeps everything after the first = , so base64 padding survives', () => {
    // The failure this guards against is silent: splitting on every `=` truncates the secret to
    // something that still looks plausible, and the platform simply refuses to authenticate.
    expect(parseSecretLines('TOKEN=aGVsbG8=')).toEqual({ TOKEN: 'aGVsbG8=' });
    expect(parseSecretLines('URL=https://x?a=1&b=2')).toEqual({ URL: 'https://x?a=1&b=2' });
  });

  it('strips one pair of surrounding quotes', () => {
    expect(parseSecretLines('A="secret"\nB=\'secret\'')).toEqual({ A: 'secret', B: 'secret' });
    // Only a *matching* pair, and only the outer one.
    expect(parseSecretLines('C="quoted"inside"')).toEqual({ C: 'quoted"inside' });
    expect(parseSecretLines("D=it's")).toEqual({ D: "it's" });
  });

  it('refuses a line that is not CLE=valeur rather than dropping it', () => {
    expect(() => parseSecretLines('CLIENT_ID abc')).toThrow(SecretSyntaxError);
    expect(() => parseSecretLines('=orphan')).toThrow(SecretSyntaxError);
  });

  it('names the offending line, counting the ones it skipped', () => {
    expect(() => parseSecretLines('# note\nA=1\noops')).toThrow(/Ligne 3/);
  });

  it('refuses a duplicate key instead of picking one', () => {
    expect(() => parseSecretLines('A=1\nA=2')).toThrow(/deux fois/);
  });

  it('allows a deliberately empty value', () => {
    expect(parseSecretLines('PASSPHRASE=')).toEqual({ PASSPHRASE: '' });
  });

  it('reads an empty box as no credentials, which leaves stored ones alone', () => {
    expect(parseSecretLines('')).toEqual({});
    expect(parseSecretLines('   \n\n')).toEqual({});
  });
});
