import { describe, it, expect } from 'vitest';
import { drawDice } from '../src/lib/engine.js';

describe('drawDice (dados deterministas)', () => {
  it('graba los valores cuando no hay secuencia (ronda sin WIP)', () => {
    const s = { diceSeq: null, diceIndex: 0, diceLog: [] };
    expect(drawDice(s, [4], 1)).toEqual([4]);
    expect(drawDice(s, [2], 1)).toEqual([2]);
    expect(s.diceLog).toEqual([4, 2]);
    expect(s.diceIndex).toBe(2);
  });

  it('reproduce la secuencia guardada e ignora lo provisto (ronda con WIP)', () => {
    const s = { diceSeq: [6, 1, 5], diceIndex: 0, diceLog: [] };
    expect(drawDice(s, [3], 1)).toEqual([6]); // ignora el 3 del cliente
    expect(drawDice(s, [3], 1)).toEqual([1]);
    expect(s.diceIndex).toBe(2);
    expect(s.diceLog).toEqual([]); // reproduciendo no se graba
  });

  it('consume dos valores en un pair', () => {
    const s = { diceSeq: [2, 4, 6], diceIndex: 0, diceLog: [] };
    expect(drawDice(s, [1, 1], 2)).toEqual([2, 4]);
    expect(s.diceIndex).toBe(2);
  });

  it('al agotarse la secuencia, cae al valor provisto sin grabar', () => {
    const s = { diceSeq: [3], diceIndex: 1, diceLog: [] };
    expect(drawDice(s, [5], 1)).toEqual([5]);
    expect(s.diceLog).toEqual([]); // hay secuencia (aunque agotada): no graba
  });
});
