'use client';

import { useEffect, useRef } from 'react';

/**
 * Attach this ref to a container and every child with
 * data-reveal will fade+slide up when it enters the viewport.
 */
export function useScrollReveal(rootMargin = '-60px') {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const targets = container.querySelectorAll<HTMLElement>('[data-reveal]');
    targets.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = '';
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const delay = el.dataset.revealDelay ?? '0';
          el.style.transition = `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          observer.unobserve(el);
        });
      },
      { rootMargin, threshold: 0.12 }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [rootMargin]);

  return ref;
}
