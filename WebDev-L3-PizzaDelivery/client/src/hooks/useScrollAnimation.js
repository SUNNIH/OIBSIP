import { useEffect, useRef } from 'react';

/**
 * Custom hook for scroll-triggered animations on mobile
 * Adds 'in-view' class when elements enter viewport
 */
export function useScrollAnimation(enabled = true) {
  const elementsRef = useRef([]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // Check if we're on mobile (max-width: 860px)
    const isMobile = window.matchMedia('(max-width: 860px)').matches;
    
    if (!isMobile) {
      // On desktop, immediately add 'in-view' class to all elements
      elementsRef.current.forEach(el => {
        if (el) el.classList.add('in-view');
      });
      return;
    }

    // Check for prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    if (prefersReducedMotion) {
      // Skip animations if user prefers reduced motion
      elementsRef.current.forEach(el => {
        if (el) el.classList.add('in-view');
      });
      return;
    }

    // Create Intersection Observer for mobile
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            // Optional: unobserve after animation triggers once
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1, // Trigger when 10% of element is visible
        rootMargin: '0px 0px -50px 0px' // Start animation slightly before element enters viewport
      }
    );

    // Observe all elements
    elementsRef.current.forEach(el => {
      if (el) observer.observe(el);
    });

    // Cleanup
    return () => {
      elementsRef.current.forEach(el => {
        if (el) observer.unobserve(el);
      });
    };
  }, [enabled]);

  // Return ref callback to collect elements
  const setRef = (index) => (el) => {
    if (el && !elementsRef.current.includes(el)) {
      elementsRef.current[index] = el;
    }
  };

  return setRef;
}
