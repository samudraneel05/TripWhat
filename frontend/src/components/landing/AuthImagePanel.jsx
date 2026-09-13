import { useEffect, useRef, useState } from "react";

const SCENES = [
  {
    img: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=1200&fit=crop&auto=format",
    coords: "48.8566° N, 2.3522° E",
    label: "Paris",
  },
  {
    img: "https://images.unsplash.com/photo-1554797589-7241bb691973?w=800&h=1200&fit=crop&auto=format",
    coords: "35.6762° N, 139.6503° E",
    label: "Tokyo",
  },
  {
    img: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&h=1200&fit=crop&auto=format",
    coords: "8.4095° S, 115.1889° E",
    label: "Bali",
  },
  {
    img: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=800&h=1200&fit=crop&auto=format",
    coords: "33.8688° S, 151.2093° E",
    label: "Sydney",
  },
  {
    img: "https://images.unsplash.com/photo-1724136620561-99a60d12f98b?w=800&h=1200&fit=crop&auto=format",
    coords: "33.9249° S, 18.4241° E",
    label: "Cape Town",
  },
];

const CROSSFADE_MS = 900;
const INTERVAL_MS = 9000;

export function AuthImagePanel() {
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);
  const reducedMotion = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );

  useEffect(() => {
    if (reducedMotion.current) return;
    timerRef.current = setInterval(() => {
      setIndex((prev) => (prev + 1) % SCENES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  return (
    <div className="auth-image-panel" aria-hidden="true">
      {SCENES.map((scene, i) => (
        <img
          key={scene.label}
          src={scene.img}
          alt=""
          className="auth-image-slide"
          style={{ opacity: i === index ? 1 : 0 }}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          draggable="false"
        />
      ))}
      <div className="auth-image-overlay">
        <span className="auth-image-coords">{SCENES[index].coords}</span>
        <span className="auth-image-label">{SCENES[index].label}</span>
      </div>
    </div>
  );
}
