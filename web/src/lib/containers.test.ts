import { describe, expect, it } from 'vitest';
import { containerProblem } from './containers';

describe('containerProblem', () => {
  it('takes DLC files up to 1 MB, whatever the case of the extension', () => {
    expect(containerProblem({ name: 'Dune.dlc', size: 4096 })).toBeNull();
    expect(containerProblem({ name: 'DUNE.DLC', size: 1024 * 1024 })).toBeNull();
  });

  it('says what is wrong with the others', () => {
    expect(containerProblem({ name: 'Dune.txt', size: 10 })).toBe('ist keine DLC-Datei.');
    expect(containerProblem({ name: 'dlc', size: 10 })).toBe('ist keine DLC-Datei.');
    expect(containerProblem({ name: 'Leer.dlc', size: 0 })).toBe('ist leer.');
    expect(containerProblem({ name: 'Gross.dlc', size: 1024 * 1024 + 1 })).toBe('ist zu gross (höchstens 1 MB).');
  });
});
