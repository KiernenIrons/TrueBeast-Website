import { useEffect } from 'react';

const REVEAL_SELECTOR = '.reveal';
const ACTIVE_CLASS = 'active';
const THRESHOLD = 0.1;

/**
 * Observes elements with the `.reveal` class and adds `.active` once they
 * scroll into view (one-shot). A MutationObserver picks up dynamically added
 * elements so late-rendered content is also revealed.
 */
export function useScrollReveal(): void {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(ACTIVE_CLASS);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: THRESHOLD },
    );

    // Observe all current `.reveal` elements
    const observe = (root: ParentNode = document): void => {
      root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => {
        if (!el.classList.contains(ACTIVE_CLASS)) {
          io.observe(el);
        }
      });
    };

    observe();

    // Watch for dynamically added `.reveal` elements
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          if (node.matches(REVEAL_SELECTOR) && !node.classList.contains(ACTIVE_CLASS)) {
            io.observe(node);
          }
          // Also check children of the added subtree
          observe(node);
        }
      }
    });

    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
