import { useEffect, useMemo, useRef } from "react";
import { geoDistance, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import landTopology from "world-atlas/land-110m.json";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import "./HeroGlobe.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const LAND = feature(landTopology, landTopology.objects.land);
const EMPTY_DESTINATIONS = [];
const INITIAL_LONGITUDE = -12;
const INITIAL_TILT = -20;
const FALLBACK_PATH = geoPath(
  geoOrthographic().rotate([INITIAL_LONGITUDE, INITIAL_TILT]).translate([500, 500]).scale(500),
)(LAND);

const SENSITIVITY = 0.35;
const TILT_SENSITIVITY = 0.18;
const MAX_TILT = 78;
const RESUME_DELAY = 1200;
const SPIN_DURATION = 82;

function cardPlacement([longitude, latitude], index) {
  if (latitude > 58) return { offset: -36, lift: 14, angle: -7 };
  if (latitude < -28) return { offset: 34, lift: -18, angle: 8 };
  if (latitude > 35 && longitude > -15 && longitude < 6) return { offset: -86, lift: 18, angle: -5 };
  if (latitude > 35 && longitude >= 6 && longitude < 30) return { offset: 84, lift: 8, angle: 6 };
  return { offset: index % 2 ? 28 : -28, lift: 20, angle: index % 2 ? 5 : -5 };
}

export function HeroGlobe({ running = false, destinations = EMPTY_DESTINATIONS }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const markerRefs = useRef([]);
  const rotationRef = useRef({ longitude: INITIAL_LONGITUDE, tilt: INITIAL_TILT });
  const runningRef = useRef(running);
  const motionRef = useRef(null);
  const dragStateRef = useRef(null);
  const points = useMemo(() => destinations
    .filter(({ coordinates }) => Array.isArray(coordinates)
      && coordinates.length === 2
      && coordinates.every(Number.isFinite)
      && Math.abs(coordinates[1]) <= 90)
    .map((destination, index) => ({ ...destination, ...cardPlacement(destination.coordinates, index) })), [destinations]);

  useEffect(() => {
    runningRef.current = running;
    motionRef.current?.();
  }, [running]);

  useGSAP(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const rotation = rotationRef.current;
    const markers = markerRefs.current.slice(0, points.length);
    const projection = geoOrthographic().clipAngle(90).precision(0.4);
    let context;
    let contextChecked = false;
    let autoTween;
    let inertiaTween;
    let resumeTimeout;
    let width = 0;
    let height = 0;
    let radius = 0;
    let centerX = 0;
    let centerY = 0;
    let ocean;
    let continents;
    let lighting;
    let disposed = false;
    let path;

    const syncMotion = () => {
      if (dragStateRef.current || inertiaTween) {
        autoTween?.pause();
        return;
      }
      autoTween?.paused(!runningRef.current);
    };
    motionRef.current = syncMotion;

    const draw = () => {
      if (disposed || !context || !width || !height) return;
      projection.rotate([rotation.longitude, rotation.tilt]);
      context.clearRect(0, 0, width, height);
      context.save();
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fillStyle = ocean;
      context.shadowColor = "#d4c39a28";
      context.shadowBlur = 16;
      context.fill();
      context.shadowBlur = 0;
      context.clip();

      context.beginPath();
      path(LAND);
      context.fillStyle = continents;
      context.fill();
      context.strokeStyle = "#c4ad7e50";
      context.lineWidth = 0.6;
      context.stroke();

      context.fillStyle = lighting;
      context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      context.restore();
      context.beginPath();
      context.arc(centerX, centerY, radius - 0.5, 0, Math.PI * 2);
      context.strokeStyle = "#fff8e580";
      context.lineWidth = 1;
      context.stroke();

      const viewCenter = projection.invert([centerX, centerY]);
      const responsiveScale = Math.min(1, Math.max(0.66, width / 760));
      points.forEach((destination, index) => {
        const marker = markers[index];
        if (!marker) return;
        const depth = Math.cos(geoDistance(destination.coordinates, viewCenter));
        const visible = depth > 0.015;
        marker.style.visibility = visible ? "visible" : "hidden";
        if (!visible) return;
        const [x, y] = projection(destination.coordinates);
        const scale = responsiveScale * (0.72 + depth * 0.28);
        marker.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;
        marker.style.opacity = String(Math.min(1, depth / 0.2) * (0.68 + depth * 0.32));
        marker.style.zIndex = String(Math.round(depth * 100));
      });
      wrapper.dataset.rendered = "true";
    };

    const resumeAutoRotation = () => {
      if (disposed) return;
      autoTween?.kill();
      autoTween = gsap.to(rotation, {
        longitude: rotation.longitude + 360,
        duration: SPIN_DURATION,
        repeat: -1,
        ease: "none",
        paused: !runningRef.current,
        onUpdate: draw,
      });
    };

    const resize = () => {
      if (disposed) return;
      const bounds = wrapper.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      if (!width || !height) {
        delete wrapper.dataset.rendered;
        markers.forEach((marker) => { if (marker) marker.style.visibility = "hidden"; });
        syncMotion();
        return;
      }
      if (!contextChecked) {
        contextChecked = true;
        try {
          context = canvas.getContext("2d");
        } catch {
          context = null;
        }
      }
      if (!context) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      radius = width * 0.42;
      centerX = width / 2;
      centerY = radius + 15;
      projection.scale(radius).translate([centerX, centerY]);
      path = geoPath(projection, context);

      ocean = context.createRadialGradient(centerX - radius * 0.32, centerY - radius * 0.45, 0, centerX, centerY, radius * 1.15);
      ocean.addColorStop(0, "#fdf8e8");
      ocean.addColorStop(0.5, "#f5eed6");
      ocean.addColorStop(1, "#e6dab8");
      continents = context.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
      continents.addColorStop(0, "#e8dab8");
      continents.addColorStop(0.45, "#dccaa2");
      continents.addColorStop(1, "#c6b282");
      lighting = context.createRadialGradient(centerX - radius * 0.3, centerY - radius * 0.42, radius * 0.12, centerX, centerY, radius);
      lighting.addColorStop(0, "#fffdf52e");
      lighting.addColorStop(0.55, "#fffdf500");
      lighting.addColorStop(0.82, "#9a85560a");
      lighting.addColorStop(1, "#8a754822");
      draw();

      if (!autoTween) {
        autoTween = gsap.to(rotation, {
          longitude: rotation.longitude + 360,
          duration: SPIN_DURATION,
          repeat: -1,
          ease: "none",
          paused: true,
          onUpdate: draw,
        });
      }
      syncMotion();
    };

    /* ---- Full 2D drag-to-rotate with inertia ---- */
    const onPointerDown = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      canvas.setPointerCapture?.(event.pointerId);
      clearTimeout(resumeTimeout);
      inertiaTween?.kill();
      inertiaTween = null;
      dragStateRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
      };
      autoTween?.pause();
      wrapper.dataset.dragging = "true";
    };

    const onPointerMove = (event) => {
      const drag = dragStateRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime);
      drag.velocityX = (dx / dt) * 16;
      drag.velocityY = (dy / dt) * 16;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastTime = now;
      rotation.longitude += dx * SENSITIVITY;
      rotation.tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, rotation.tilt - dy * TILT_SENSITIVITY));
      draw();
    };

    const endDrag = (event) => {
      const drag = dragStateRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      canvas.releasePointerCapture?.(drag.pointerId);
      dragStateRef.current = null;
      delete wrapper.dataset.dragging;

      const vx = drag.velocityX;
      const vy = drag.velocityY;
      const hasVelocity = Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4;

      if (hasVelocity) {
        inertiaTween = gsap.to(rotation, {
          longitude: rotation.longitude + vx * 8,
          tilt: Math.max(-MAX_TILT, Math.min(MAX_TILT, rotation.tilt - vy * 4)),
          duration: 1.6,
          ease: "power3.out",
          onUpdate: draw,
          onComplete: () => {
            inertiaTween = null;
            resumeTimeout = setTimeout(resumeAutoRotation, RESUME_DELAY);
          },
        });
      } else {
        resumeTimeout = setTimeout(resumeAutoRotation, RESUME_DELAY);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(wrapper);
    window.addEventListener("resize", resize);
    resize();

    return () => {
      disposed = true;
      autoTween?.kill();
      inertiaTween?.kill();
      clearTimeout(resumeTimeout);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      if (motionRef.current === syncMotion) motionRef.current = null;
      delete wrapper.dataset.rendered;
      markers.forEach((marker) => { if (marker) marker.style.visibility = "hidden"; });
    };
  }, { scope: wrapperRef, dependencies: [points] });

  return (
    <div className="hero-globe" ref={wrapperRef}>
      <div className="hero-globe-fallback" aria-hidden="true">
        <svg viewBox="0 0 1000 1000" focusable="false"><path d={FALLBACK_PATH} /></svg>
      </div>
      <canvas
        ref={canvasRef}
        className="hero-globe-canvas"
        role="img"
        aria-label="Rotating golden globe with travel destinations — drag to spin"
      />
      <div className="hero-globe-destinations" aria-hidden="true">
        {points.map((destination, index) => (
          <div
            className="hero-globe-marker"
            key={`${destination.label}-${destination.coordinates.join(",")}`}
            ref={(element) => { markerRefs.current[index] = element; }}
          >
            <span
              className="hero-globe-leader"
              style={{
                width: Math.hypot(destination.offset, destination.lift),
                transform: `rotate(${Math.atan2(-destination.lift, destination.offset)}rad)`,
              }}
            />
            <span className="hero-globe-dot" />
            <div
              className="hero-globe-card"
              style={{ left: destination.offset, bottom: destination.lift, "--hero-globe-card-angle": `${destination.angle}deg` }}
            >
              <img src={destination.img} alt="" loading="lazy" decoding="async" draggable="false" />
              <span className="hero-globe-card-label">{destination.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
