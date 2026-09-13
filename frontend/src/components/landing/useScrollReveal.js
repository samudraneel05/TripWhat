import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const EASE_OUT = "power3.out";

/**
 * ScrollTrigger reveal animations for landing-page card groups.
 * Animates transform + opacity only (compositor-friendly).
 * Respects prefers-reduced-motion by skipping animation entirely.
 */
export function useScrollReveal() {
  const containerRef = useRef(null);

  useGSAP(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduced) return;

    const ctx = gsap.context(() => {
      /* Benefits bar — fade up as a row */
      gsap.from(".landing-benefits > span", {
        scrollTrigger: { trigger: ".landing-benefits", start: "top 88%" },
        y: 18,
        opacity: 0,
        duration: 0.5,
        ease: EASE_OUT,
        stagger: 0.08,
      });

      /* Section headings — gentle fade up */
      gsap.from(".landing-section-heading", {
        scrollTrigger: { trigger: ".landing-section-heading", start: "top 85%" },
        y: 24,
        opacity: 0,
        duration: 0.6,
        ease: EASE_OUT,
      });

      /* Story articles — slide in from the side they're on */
      gsap.utils.toArray(".landing-story").forEach((story) => {
        const isReverse = story.classList.contains("landing-story-reverse");
        gsap.from(story, {
          scrollTrigger: { trigger: story, start: "top 82%" },
          x: isReverse ? 40 : -40,
          opacity: 0,
          duration: 0.7,
          ease: EASE_OUT,
        });
      });

      /* Research cards — staggered fade up */
      gsap.from(".landing-research-grid > article", {
        scrollTrigger: { trigger: ".landing-research-grid", start: "top 85%" },
        y: 32,
        opacity: 0,
        duration: 0.55,
        ease: EASE_OUT,
        stagger: 0.12,
      });

      /* Destination cards — staggered fade up with scale */
      gsap.from(".landing-destination-grid > .landing-destination", {
        scrollTrigger: { trigger: ".landing-destination-grid", start: "top 85%" },
        y: 36,
        scale: 0.96,
        opacity: 0,
        duration: 0.6,
        ease: EASE_OUT,
        stagger: 0.1,
      });

      /* FAQ items — staggered fade */
      gsap.from(".landing-questions > details", {
        scrollTrigger: { trigger: ".landing-questions", start: "top 88%" },
        y: 16,
        opacity: 0,
        duration: 0.45,
        ease: EASE_OUT,
        stagger: 0.08,
      });

      /* Finale — fade up */
      gsap.from(".landing-finale > *", {
        scrollTrigger: { trigger: ".landing-finale", start: "top 80%" },
        y: 22,
        opacity: 0,
        duration: 0.6,
        ease: EASE_OUT,
        stagger: 0.1,
      });
    }, containerRef);

    return () => ctx.revert();
  }, { scope: containerRef });

  return containerRef;
}
