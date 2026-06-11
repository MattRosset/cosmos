import { describe, expect, it } from 'vitest';
import { spectralClassFromBV } from '../src/spectral';

describe('spectralClassFromBV', () => {
  it('bv < 0.0 → B', () => {
    expect(spectralClassFromBV(-0.5)).toBe('B');
    expect(spectralClassFromBV(-0.001)).toBe('B');
  });

  it('boundary: bv = 0.0 → A (not B)', () => {
    expect(spectralClassFromBV(0.0)).toBe('A');
  });

  it('[0.0, 0.3) → A', () => {
    expect(spectralClassFromBV(0.0)).toBe('A');
    expect(spectralClassFromBV(0.15)).toBe('A');
    expect(spectralClassFromBV(0.299)).toBe('A');
  });

  it('boundary: bv = 0.3 → F (not A)', () => {
    expect(spectralClassFromBV(0.3)).toBe('F');
  });

  it('[0.3, 0.58) → F', () => {
    expect(spectralClassFromBV(0.3)).toBe('F');
    expect(spectralClassFromBV(0.45)).toBe('F');
    expect(spectralClassFromBV(0.579)).toBe('F');
  });

  it('boundary: bv = 0.58 → G (not F)', () => {
    expect(spectralClassFromBV(0.58)).toBe('G');
  });

  it('[0.58, 0.81) → G', () => {
    expect(spectralClassFromBV(0.58)).toBe('G');
    expect(spectralClassFromBV(0.65)).toBe('G');
    expect(spectralClassFromBV(0.809)).toBe('G');
  });

  it('boundary: bv = 0.81 → K (not G)', () => {
    expect(spectralClassFromBV(0.81)).toBe('K');
  });

  it('[0.81, 1.40) → K', () => {
    expect(spectralClassFromBV(0.81)).toBe('K');
    expect(spectralClassFromBV(1.0)).toBe('K');
    expect(spectralClassFromBV(1.399)).toBe('K');
  });

  it('boundary: bv = 1.40 → M (not K)', () => {
    expect(spectralClassFromBV(1.4)).toBe('M');
  });

  it('≥ 1.40 → M', () => {
    expect(spectralClassFromBV(1.4)).toBe('M');
    expect(spectralClassFromBV(2.0)).toBe('M');
  });
});
