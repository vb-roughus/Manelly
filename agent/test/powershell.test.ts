import { describe, expect, it } from 'vitest';
import { decodeClixml, scriptArgs, scriptError } from '../src/powershell.js';

// Windows PowerShell's stderr when a script fails before it can report itself, e.g. it does not parse.
const ERROR_CLIXML =
  '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">Ausnahme beim Aufrufen von "Protect" mit 3 Argument(en):  &quot;Zugriff verweigert&quot;_x000D__x000A_</S><S S="Error">In Zeile:4 Zeichen:1_x000D__x000A_</S></Objs>';

describe('PowerShell', () => {
  it('runs scripts without progress records, reporting their errors on stdout', () => {
    const args = scriptArgs('[Console]::Out.Write(42)');
    expect(args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-NoLogo', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand']);
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    expect(script).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(script).toContain('[Console]::Out.Write(42)');
    expect(script).toContain('[Console]::Out.Write("ERROR: $($e.Message)")');
  });

  it('reads the error text out of CLIXML', () => {
    expect(decodeClixml(ERROR_CLIXML)).toBe('Ausnahme beim Aufrufen von "Protect" mit 3 Argument(en):  "Zugriff verweigert"\r\nIn Zeile:4 Zeichen:1\r\n');
    expect(decodeClixml('Plain text')).toBe('Plain text');
  });

  it('names why a script failed in one line', () => {
    expect(scriptError('ERROR: Der Schlüsselsatz ist nicht vorhanden.', ERROR_CLIXML, 1)).toBe('Der Schlüsselsatz ist nicht vorhanden.');
    expect(scriptError('', ERROR_CLIXML, 1)).toBe('Ausnahme beim Aufrufen von "Protect" mit 3 Argument(en):  "Zugriff verweigert"');
    expect(scriptError('', '', 1)).toBe('PowerShell endete mit 1.');
  });
});
