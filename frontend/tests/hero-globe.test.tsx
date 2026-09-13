import '@testing-library/jest-dom/vitest';
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroGlobe } from "../src/components/landing/HeroGlobe";

const animation = vi.hoisted(() => ({
  to: vi.fn(),
  registerPlugin: vi.fn(),
  context: (fn: () => unknown) => {
    fn();
    return { revert: vi.fn() };
  },
  utils: { toArray: vi.fn(() => []) },
}));
vi.mock("gsap", () => ({ gsap: animation, default: animation }));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: { register: vi.fn() } }));

const DESTINATIONS = [
  { label: "Paris", img: "/paris.jpg", coordinates: [2.35, 48.86] },
  { label: "Iceland", img: "/iceland.jpg", coordinates: [-19, 65] },
  { label: "Alps", img: "/alps.jpg", coordinates: [10, 46.5] },
  { label: "Backside", img: "/backside.jpg", coordinates: [-168, -20] },
];

let width: number;
let context: Record<string, ReturnType<typeof vi.fn>>;
let observers: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;
let tweens: Array<{
  target: { longitude: number; tilt: number };
  options: { onUpdate: () => void; paused: boolean; duration: number };
  paused: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
}>;

beforeEach(() => {
  width = 900;
  observers = [];
  tweens = [];
  context = Object.fromEntries([
    "setTransform", "clearRect", "save", "beginPath", "arc", "fill", "clip", "stroke",
    "fillRect", "restore", "moveTo", "lineTo", "closePath",
  ].map((method) => [method, vi.fn()]));
  context.createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  context.createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 360 } as DOMRect));
  vi.stubGlobal("devicePixelRatio", 3);
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
  });
  animation.to.mockImplementation((target, options) => {
    const tween = { target, options, paused: vi.fn(), kill: vi.fn() };
    tweens.push(tween);
    return tween;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  animation.to.mockReset();
});

describe("HeroGlobe", () => {
  it("draws a static accessible globe with capped pixel density and decorative front-facing cards", () => {
    const { container } = render(<HeroGlobe running={false} destinations={DESTINATIONS} />);
    const canvas = screen.getByRole("img", { name: "Rotating golden globe with travel destinations — drag to spin" });
    expect(canvas).toHaveAttribute("width", "1800");
    expect(canvas).toHaveAttribute("height", "720");
    expect(container.firstChild).toHaveAttribute("data-rendered", "true");
    expect(context.lineTo).toHaveBeenCalled();
    expect(tweens[0].paused).toHaveBeenLastCalledWith(true);
    expect(tweens[0].options.duration).toBe(82);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector(".hero-globe-destinations")).toHaveAttribute("aria-hidden", "true");
    expect([...container.querySelectorAll("img")].every((image) => image.alt === "")).toBe(true);
    const markers = container.querySelectorAll<HTMLElement>(".hero-globe-marker");
    expect([...markers].map((marker) => marker.style.visibility)).toEqual(["visible", "visible", "visible", "hidden"]);
  });

  it("pauses and resumes the same rotation without resetting its phase", () => {
    const { container, rerender } = render(<HeroGlobe running destinations={DESTINATIONS} />);
    expect(tweens[0].paused).toHaveBeenLastCalledWith(false);
    const marker = container.querySelector<HTMLElement>(".hero-globe-marker")!;
    const initialPosition = marker.style.transform;
    act(() => {
      tweens[0].target.longitude += 35;
      tweens[0].options.onUpdate();
    });
    expect(marker.style.transform).not.toBe(initialPosition);
    const pausedPosition = marker.style.transform;
    rerender(<HeroGlobe running={false} destinations={DESTINATIONS} />);
    expect(tweens[0].paused).toHaveBeenLastCalledWith(true);
    rerender(<HeroGlobe running destinations={DESTINATIONS} />);
    expect(tweens[0].paused).toHaveBeenLastCalledWith(false);
    expect(animation.to).toHaveBeenCalledTimes(1);
    expect(marker.style.transform).toBe(pausedPosition);
    expect(tweens[0].target.longitude).toBe(23);
  });

  it("defers canvas initialization for zero width and resizes a paused globe", () => {
    width = 0;
    const { container } = render(<HeroGlobe running={false} destinations={DESTINATIONS} />);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(animation.to).not.toHaveBeenCalled();
    expect(container.firstChild).not.toHaveAttribute("data-rendered");
    width = 600;
    act(() => observers[0].callback());
    expect(screen.getByRole("img")).toHaveAttribute("width", "1200");
    expect(tweens[0].paused).toHaveBeenLastCalledWith(true);
    expect(container.firstChild).toHaveAttribute("data-rendered", "true");
    width = 0;
    act(() => observers[0].callback());
    expect(container.firstChild).not.toHaveAttribute("data-rendered");
    expect(tweens[0].paused).toHaveBeenLastCalledWith(true);
  });

  it("keeps the silhouette fallback without a Canvas2D context", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const { container } = render(<HeroGlobe running destinations={DESTINATIONS} />);
    expect(container.firstChild).not.toHaveAttribute("data-rendered");
    expect(container.querySelector(".hero-globe-fallback path")?.getAttribute("d")?.length).toBeGreaterThan(1000);
    expect(animation.to).not.toHaveBeenCalled();
  });

  it("cleans up both StrictMode mounts, their observers, and late draw callbacks", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<StrictMode><HeroGlobe running destinations={DESTINATIONS} /></StrictMode>);
    expect(tweens).toHaveLength(2);
    expect(tweens[0].kill).toHaveBeenCalledOnce();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    unmount();
    expect(tweens[1].kill).toHaveBeenCalledOnce();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls.filter(([event]) => event === "resize")).toHaveLength(2);
    context.clearRect.mockClear();
    act(() => {
      tweens[1].options.onUpdate();
      observers[1].callback();
    });
    expect(context.clearRect).not.toHaveBeenCalled();
  });
});
