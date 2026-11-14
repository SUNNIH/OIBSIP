// SUNNYS Pizza — Test Setup
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock global fetch for all tests
global.fetch = vi.fn();

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// SUNNYS_MATCH_MEDIA_TEST_POLYFILL
// Provides window.matchMedia for component tests running in jsdom.

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,

      addListener: () => {},
      removeListener: () => {},

      addEventListener: () => {},
      removeEventListener: () => {},

      dispatchEvent: () => false,
    }),
  });
}


// SUNNYS_SCROLL_TO_MOCK
// Mock browser scrolling for jsdom component tests.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    configurable: true,
    value: () => {},
  });
}

