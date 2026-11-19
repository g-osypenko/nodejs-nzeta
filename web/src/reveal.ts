import { useCallback, useEffect, useRef } from 'react';

/**
 * Fade-up on first appearance: returns a ref callback; elements with class `reveal` get
 * `is-visible` when they enter the viewport. With `prefers-reduced-motion` the CSS shows them at
 * once, and without IntersectionObserver they are simply visible.
 */
export function useReveal(): (el: HTMLElement | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return (): void => observer.current?.disconnect();
  }, []);

  return useCallback((el: HTMLElement | null): void => {
    if (el === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return;
    }
    observer.current ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.current?.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.current.observe(el);
  }, []);
}
