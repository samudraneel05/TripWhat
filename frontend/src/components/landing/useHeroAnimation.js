import { useEffect, useState } from "react";

export function useHeroAnimation(containerRef, paused) {
  const [running, setRunning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let inView = false;
    const update = () => {
      const reduced = media?.matches ?? true;
      setReducedMotion(reduced);
      setRunning(!paused && inView && !document.hidden && !reduced);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });

    if (observer && containerRef.current) observer.observe(containerRef.current);
    else inView = true;
    media?.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();

    return () => {
      observer?.disconnect();
      media?.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [containerRef, paused]);

  return { running, reducedMotion };
}
