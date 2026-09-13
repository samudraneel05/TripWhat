import { useEffect, useRef } from "react";
import gsap from "gsap";

export const PROMPT_EXAMPLES = [
  "Plan a weekend in Paris for two, with cafés and art.",
  "Explore Japan for a week, from Tokyo to Kyoto.",
  "Find a quiet beach escape with great local food.",
  "Take me on a scenic road trip through Iceland.",
];

export function createPromptCycle(element, prompts = PROMPT_EXAMPLES) {
  const timeline = gsap.timeline({ paused: true, repeat: -1 });
  for (const prompt of prompts) {
    const characters = Array.from(prompt);
    const cursor = { length: 0 };
    const paint = () => {
      element.textContent = characters.slice(0, Math.round(cursor.length)).join("");
    };
    timeline.to(cursor, { length: characters.length, duration: characters.length * 0.045, ease: "none", onUpdate: paint });
    timeline.to({}, { duration: 1.8 });
    timeline.to(cursor, { length: 0, duration: characters.length * 0.022, ease: "none", onUpdate: paint });
    timeline.to({}, { duration: 0.4 });
  }
  return timeline;
}

export function CyclingPrompt({ running, reducedMotion, hidden }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const cycleRef = useRef(null);

  useEffect(() => {
    if (reducedMotion) {
      textRef.current.textContent = PROMPT_EXAMPLES[0];
      return;
    }
    const context = gsap.context(() => {
      cycleRef.current = createPromptCycle(textRef.current);
    }, containerRef);
    return () => {
      context.revert();
      cycleRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (running && !hidden) cycleRef.current?.play();
    else cycleRef.current?.pause();
  }, [running, hidden, reducedMotion]);

  return (
    <span ref={containerRef} className="landing-prompt-example" aria-hidden="true" hidden={hidden} data-running={running && !hidden}>
      <span ref={textRef}>{PROMPT_EXAMPLES[0]}</span><span className="landing-prompt-caret" />
    </span>
  );
}
