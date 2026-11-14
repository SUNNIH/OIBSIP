// SUNNYS Pizza — Touchscreen Swipe Navigation Hook
// Implements swipe-right (back) and swipe-left (forward) gestures

import { useEffect, useRef } from 'react';

/**
 * Hook to enable horizontal swipe gestures for browser history navigation
 * 
 * Swipe right: Navigate back
 * Swipe left: Navigate forward
 * 
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled - Enable/disable swipe detection (default: true)
 * @param {number} options.threshold - Minimum swipe distance in pixels (default: 50)
 * @param {number} options.maxVerticalRatio - Max vertical/horizontal ratio to prevent interfering with scrolling (default: 0.5)
 */
export function useSwipeNavigation(options = {}) {
  const {
    enabled = true,
    threshold = 50,
    maxVerticalRatio = 0.5
  } = options;

  const touchStartRef = useRef(null);
  const touchEndRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e) => {
      // Skip if touching interactive elements
      const target = e.target;
      if (
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select') ||
        target.closest('button') ||
        target.closest('a') ||
        target.closest('.modal') ||
        target.closest('.pizza-builder') ||
        target.closest('.checkout') ||
        target.closest('form') ||
        target.closest('[role="dialog"]') ||
        target.closest('.horizontal-scroll') ||
        target.closest('table')
      ) {
        touchStartRef.current = null;
        return;
      }

      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now()
      };
      touchEndRef.current = null;
    };

    const handleTouchMove = (e) => {
      if (!touchStartRef.current) return;

      touchEndRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    };

    const handleTouchEnd = () => {
      if (!touchStartRef.current || !touchEndRef.current) {
        touchStartRef.current = null;
        touchEndRef.current = null;
        return;
      }

      const deltaX = touchEndRef.current.x - touchStartRef.current.x;
      const deltaY = touchEndRef.current.y - touchStartRef.current.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Check if gesture is primarily horizontal
      const verticalRatio = absDeltaX > 0 ? absDeltaY / absDeltaX : Infinity;

      if (verticalRatio > maxVerticalRatio) {
        // Too much vertical movement - likely a scroll
        touchStartRef.current = null;
        touchEndRef.current = null;
        return;
      }

      // Check if swipe meets threshold
      if (absDeltaX > threshold && absDeltaX > absDeltaY) {
        if (deltaX > 0) {
          // Swipe right - go back
          window.history.back();
        } else {
          // Swipe left - go forward
          window.history.forward();
        }
      }

      touchStartRef.current = null;
      touchEndRef.current = null;
    };

    // Attach to document body to catch all touches
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, threshold, maxVerticalRatio]);
}
