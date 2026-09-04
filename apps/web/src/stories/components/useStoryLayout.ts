import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 900px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function readQuery(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** Keeps responsive rendering decisions in sync with the browser media queries. */
export function useStoryLayout() {
  const [mobile, setMobile] = useState(() => readQuery(MOBILE_QUERY));
  const [reducedMotion, setReducedMotion] = useState(() => readQuery(REDUCED_MOTION_QUERY));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => {
      setMobile(mobileQuery.matches);
      setReducedMotion(motionQuery.matches);
    };
    update();
    mobileQuery.addEventListener('change', update);
    motionQuery.addEventListener('change', update);
    return () => {
      mobileQuery.removeEventListener('change', update);
      motionQuery.removeEventListener('change', update);
    };
  }, []);

  return { mobile, reducedMotion };
}
