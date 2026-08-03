import { describe, it, expect } from 'vitest';
import { gaiaCardFor, type GaiaCardDetails } from './gaia-card';

/**
 * TASK-089 D5.2 — the single-slot holder's lineage match-check, the guard against the
 * task's #1 named risk (a slow async id-upgrade of an OLD click painting its physics onto
 * a NEWER pick's card). This is the safety-critical branch; the anti-tests below are the
 * mismatch cases a broken guard (e.g. dropping the `=== holder.catalogId` clause, or using
 * `Number(sourceId)`) would fail.
 */

const CATALOG_ID = 42;
// A realistic DR3 source_id: 19 digits, > 2^53 (Number would truncate it).
const SOURCE_ID = 6827136600469308288n;

function holderProvisional(): GaiaCardDetails {
  return { catalogId: CATALOG_ID, sourceId: null, positionPc: [1, 2, 3], absMag: 4, colorIndexBV: 0.6 };
}
function holderUpgraded(): GaiaCardDetails {
  return { ...holderProvisional(), sourceId: SOURCE_ID };
}

describe('gaiaCardFor — lineage match-check (TASK-089 D5.2)', () => {
  it('matches a provisional id against holder.catalogId', () => {
    const holder = holderProvisional();
    expect(gaiaCardFor(`gaia:${CATALOG_ID}`, holder)).toBe(holder);
  });

  it('matches an upgraded 19-digit source_id via BigInt (no Number truncation)', () => {
    const holder = holderUpgraded();
    expect(gaiaCardFor(`gaia:${SOURCE_ID.toString()}`, holder)).toBe(holder);
  });

  // ── Anti-tests: a broken guard would return the holder here and paint stale physics. ──

  it('returns null when the id lineage does NOT match the holder (stale-holder guard)', () => {
    // Newer selection gaia:99 while the holder still carries the OLD click's star (42).
    expect(gaiaCardFor('gaia:99', holderProvisional())).toBeNull();
  });

  it('does NOT match a source_id-shaped id against a still-provisional holder', () => {
    // Holder has not yet upgraded (sourceId null); an upgraded id must NOT match on the
    // catalogId branch just because Number(bigId) is integer-valued.
    expect(gaiaCardFor(`gaia:${SOURCE_ID.toString()}`, holderProvisional())).toBeNull();
  });

  it('does NOT match an upgraded holder against a DIFFERENT source_id', () => {
    expect(gaiaCardFor('gaia:1234567890123456789', holderUpgraded())).toBeNull();
  });

  // ── Degrade / boundary cases ──

  it('returns null for a non-gaia id', () => {
    expect(gaiaCardFor('hyg-v41:123', holderProvisional())).toBeNull();
  });

  it('returns null when the holder is empty', () => {
    expect(gaiaCardFor(`gaia:${CATALOG_ID}`, null)).toBeNull();
  });

  it('returns null (no throw) for a non-numeric tail with an upgraded holder', () => {
    expect(gaiaCardFor('gaia:not-a-number', holderUpgraded())).toBeNull();
  });
});
