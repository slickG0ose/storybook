import { describe, it, expect } from 'vitest';
import { isEditable, PUBLISHED_IMMUTABLE_ERROR } from '../availability';

describe('isEditable', () => {
  it('allows mutation of a draft book', () => {
    expect(isEditable({ status: 'draft' })).toBe(true);
  });

  it('refuses mutation of a published book', () => {
    expect(isEditable({ status: 'published' })).toBe(false);
  });

  it('fails closed on an unexpected status', () => {
    // Anything that isn't exactly 'draft' is immutable. A future status value
    // must opt in here rather than silently inheriting write access.
    expect(isEditable({ status: 'archived' })).toBe(false);
    expect(isEditable({ status: '' })).toBe(false);
    expect(isEditable({ status: 'DRAFT' })).toBe(false);
  });
});

describe('PUBLISHED_IMMUTABLE_ERROR', () => {
  it('is a non-empty string every 403 can share', () => {
    expect(typeof PUBLISHED_IMMUTABLE_ERROR).toBe('string');
    expect(PUBLISHED_IMMUTABLE_ERROR.length).toBeGreaterThan(0);
  });
});
