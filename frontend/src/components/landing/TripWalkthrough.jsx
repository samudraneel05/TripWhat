import { useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Compass,
  MapPin,
  MessageCircle,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import "./TripWalkthrough.css";

const SAMPLE_PROMPT = "Plan a relaxed 3-day trip to Paris with cafés, art, and time to wander.";

const STEPS = [
  {
    label: "Describe your trip",
    hint: "A little daydream is enough.",
    title: "Start with what you love.",
    copy: "A destination, a few interests, your kind of pace. No perfect prompt needed.",
    reply: "Paris, at your pace. Let’s leave room for slow coffees, a little art, and the streets in between.",
    icon: MessageCircle,
  },
  {
    label: "Find your places",
    hint: "Turn your interests into a shortlist.",
    title: "Find your kind of somewhere.",
    copy: "Bring places together on a map, so the shape of your trip starts to make sense.",
    reply: "For this sample trip: a Saint-Germain café, the Musée d’Orsay, and a wander through the Tuileries.",
    icon: MapPin,
  },
  {
    label: "See your days",
    hint: "Give the trip a little shape.",
    title: "A plan, not a packed schedule.",
    copy: "See your stops day by day, with breathing room for the good things you didn’t plan.",
    reply: "Here’s a gentle first day: coffee, a museum, then a garden stroll. The rest of Paris can wait.",
    icon: Compass,
  },
  {
    label: "Make it yours",
    hint: "Nothing is set in stone.",
    title: "Change your mind. It’s your trip.",
    copy: "Try removing the museum below. The sample day and map update together. Add it back whenever you like.",
    reply: "Prefer more wandering? Take the museum off your day and keep the afternoon open. You’re in charge.",
    icon: SlidersHorizontal,
  },
];

const STOPS = [
  { name: "Saint-Germain café", detail: "A slow start", time: "Morning", x: 224, y: 264 },
  { name: "Musée d’Orsay", detail: "A little art", time: "Midday", x: 310, y: 178 },
  { name: "Tuileries Garden", detail: "Room to wander", time: "Afternoon", x: 396, y: 120 },
];

export function TripWalkthrough({ onStart }) {
  const [step, setStep] = useState(0);
  const [museumIncluded, setMuseumIncluded] = useState(true);
  const id = useId();
  const tabRefs = useRef([]);
  const visibleStops = STOPS.filter((_, index) => index !== 1 || museumIncluded);

  const selectStep = (nextStep, focus = false) => {
    setStep(nextStep);
    if (focus) tabRefs.current[nextStep]?.focus();
  };

  const handleTabKey = (event, index) => {
    let nextStep;
    if (event.key === "ArrowRight") nextStep = (index + 1) % STEPS.length;
    if (event.key === "ArrowLeft") nextStep = (index + STEPS.length - 1) % STEPS.length;
    if (event.key === "Home") nextStep = 0;
    if (event.key === "End") nextStep = STEPS.length - 1;
    if (nextStep === undefined) return;
    event.preventDefault();
    selectStep(nextStep, true);
  };

  const reset = () => {
    setMuseumIncluded(true);
    selectStep(0, true);
  };

  return (
    <div className="tw-walkthrough">
      <div className="tw-tabs" role="tablist" aria-label="Trip planning walkthrough">
        {STEPS.map((item, index) => (
          <button
            key={item.label}
            className={`tw-tab${step === index ? " tw-tab-active" : ""}`}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={step === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={step === index ? 0 : -1}
            ref={(element) => { tabRefs.current[index] = element; }}
            onClick={() => selectStep(index)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span className="tw-step-number" aria-hidden="true">0{index + 1}</span>
            <span className="tw-tab-copy">
              <span className="tw-tab-label">{item.label}</span>
              <span className="tw-tab-hint">{item.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="tw-window">
        <div className="tw-window-bar">
          <div className="tw-window-brand">
            <span className="tw-window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="tw-preview-label"><span className="tw-preview-dot" />Interactive preview</span>
          </div>
          <span className="tw-sample-label">Sample trip · Paris</span>
        </div>

        {STEPS.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              className="tw-panel"
              role="tabpanel"
              id={`${id}-panel-${index}`}
              aria-labelledby={`${id}-tab-${index}`}
              key={item.label}
              hidden={step !== index}
              tabIndex={0}
            >
              {step === index && (
                <div className="tw-workspace">
                  <div className="tw-conversation">
                    <div className="tw-step-icon"><Icon size={19} aria-hidden="true" /></div>
                    <p className="tw-eyebrow">A little inspiration, a real direction</p>
                    <h3 className="tw-step-title">{item.title}</h3>
                    <p className="tw-step-description">{item.copy}</p>
                    <div className="tw-chat">
                      <p className="tw-chat-person">You</p>
                      <p className="tw-user-message">{SAMPLE_PROMPT}</p>
                      <p className="tw-chat-person tw-assistant-name"><Sparkles size={13} aria-hidden="true" /> TripWhat · sample response</p>
                      <p className="tw-assistant-message">{item.reply}</p>
                    </div>
                    <p className="tw-local-note">Just a demo. Nothing is saved or booked.</p>
                  </div>

                  <div className="tw-trip-preview">
                    <div className="tw-trip-heading">
                      <div>
                        <p className="tw-eyebrow">Your next little escape</p>
                        <h4 className="tw-trip-title">Paris, unhurried.</h4>
                      </div>
                      <span className="tw-duration">3 days <span aria-hidden="true">/</span> easy pace</span>
                    </div>

                    <div className={`tw-preview-layout${step >= 2 ? " tw-preview-layout-days" : ""}`}>
                      <div className="tw-map">
                        <svg
                          className="tw-map-drawing"
                          viewBox="0 0 600 380"
                          role="img"
                          aria-label={`Illustrative Paris map with ${visibleStops.length} sample stops: ${visibleStops.map((stop) => stop.name).join(", ")}. Not for navigation.`}
                        >
                          <rect width="600" height="380" fill="#f3f0e8" />
                          <path d="M0 55L600 325M0 175L420 0M90 380L405 0M280 380L565 0M0 308L600 75M0 100L600 150M480 380L260 0" fill="none" stroke="#fffdf9" strokeWidth="19" />
                          <path d="M0 55L600 325M0 175L420 0M90 380L405 0M280 380L565 0M0 308L600 75M0 100L600 150M480 380L260 0" fill="none" stroke="#e8e2d7" strokeWidth="1" />
                          <path d="M-35 360C112 324 88 201 222 205S377 271 419 220S466 68 636 44" fill="none" stroke="#cedee0" strokeWidth="40" />
                          <path d="M-35 360C112 324 88 201 222 205S377 271 419 220S466 68 636 44" fill="none" stroke="#e7f0ef" strokeWidth="2" />
                          <path d="M333 125L404 84L442 120L370 160Z" fill="#dce4cd" />
                          <path d="M112 290L166 259L198 307L144 334Z" fill="#e0e6d2" />
                          <path d="M260 184L258 233M379 218L402 248M466 122L502 149" stroke="#fffdf9" strokeWidth="11" />
                          <text x="55" y="105" className="tw-map-neighborhood">7TH ARR.</text>
                          <text x="403" y="57" className="tw-map-neighborhood">1ST ARR.</text>
                          <text x="329" y="327" className="tw-map-neighborhood">SAINT-GERMAIN</text>
                          <text x="444" y="260" className="tw-river-label" transform="rotate(-38 444 260)">La Seine</text>
                          <path d={museumIncluded ? "M224 264Q243 209 310 178Q344 139 396 120" : "M224 264Q305 239 396 120"} className="tw-map-route" />
                          {visibleStops.map((stop, stopIndex) => (
                            <g key={stop.name} transform={`translate(${stop.x} ${stop.y})`} className="tw-map-pin">
                              <circle r="22" fill="#df542e" opacity="0.12" />
                              <circle r="15" fill="#df542e" stroke="#fffdf9" strokeWidth="3" />
                              <text y="4" textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">{stopIndex + 1}</text>
                            </g>
                          ))}
                        </svg>
                        <span className="tw-map-caption"><MapPin size={12} aria-hidden="true" /> Illustrative map</span>
                        <span className="tw-map-count">{visibleStops.length} sample stops</span>
                      </div>

                      {step < 2 ? (
                        <div className="tw-discovery">
                          <div className="tw-discovery-heading"><span>{step === 0 ? "The feeling we’re going for" : "A few places to begin"}</span><span className="tw-small-note">Sample ideas</span></div>
                          {step === 0 ? (
                            <div className="tw-interest-list">
                              <span className="tw-interest"><Coffee size={15} aria-hidden="true" /> Café mornings</span>
                              <span className="tw-interest"><Sparkles size={15} aria-hidden="true" /> A little art</span>
                              <span className="tw-interest"><Compass size={15} aria-hidden="true" /> Unplanned afternoons</span>
                            </div>
                          ) : (
                            <ol className="tw-place-list" aria-label="Sample places">
                              {visibleStops.map((stop, stopIndex) => (
                                <li className="tw-place" key={stop.name}>
                                  <span className="tw-stop-number">{stopIndex + 1}</span>
                                  <span><span className="tw-place-name">{stop.name}</span><span className="tw-place-detail">{stop.detail}</span></span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      ) : (
                        <div className="tw-itinerary">
                          <p className="tw-eyebrow">Sample itinerary</p>
                          <h5 className="tw-day-title">Day 1 <span>Art & little detours</span></h5>
                          <ol className="tw-day-stops" aria-label="Day 1 sample stops">
                            {visibleStops.map((stop, stopIndex) => (
                              <li className="tw-day-stop" key={stop.name}>
                                <span className="tw-stop-number">{stopIndex + 1}</span>
                                <span><span className="tw-stop-time">{stop.time}</span><span className="tw-place-name">{stop.name}</span></span>
                              </li>
                            ))}
                          </ol>
                          {step === 3 && (
                            <button className="tw-edit-stop" type="button" onClick={() => setMuseumIncluded((included) => !included)}>
                              {museumIncluded ? <Trash2 size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                              {museumIncluded ? "Remove Musée d’Orsay" : "Add Musée d’Orsay back"}
                            </button>
                          )}
                          {!museumIncluded && <p className="tw-free-time"><Check size={13} aria-hidden="true" /> More time to wander.</p>}
                          <div className="tw-other-days"><span>Day 2 · Le Marais</span><span>Day 3 · Montmartre</span></div>
                        </div>
                      )}
                    </div>
                    <p className="tw-preview-footnote">A sample to show what’s possible. Your trip starts with you.</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="tw-controls">
          <button className="tw-back" type="button" disabled={step === 0} onClick={() => selectStep(step - 1, true)} aria-label="Previous step">
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <span className="tw-progress">Step {step + 1} of {STEPS.length}</span>
          <div className="tw-forward-controls">
            {step === STEPS.length - 1 ? (
              <>
                <button className="tw-reset" type="button" onClick={reset}><RotateCcw size={14} aria-hidden="true" /> Start over</button>
                <button className="tw-next" type="button" onClick={() => onStart(SAMPLE_PROMPT)}>Plan my trip <ArrowRight size={16} aria-hidden="true" /></button>
              </>
            ) : (
              <button className="tw-next" type="button" onClick={() => selectStep(step + 1, true)}>Next step <ArrowRight size={16} aria-hidden="true" /></button>
            )}
          </div>
        </div>
      </div>
      <p className="tw-sr-only" role="status" aria-live="polite" aria-atomic="true">Step {step + 1} of 4: {STEPS[step].label}. {museumIncluded ? "3 sample stops." : "Museum removed. 2 sample stops."}</p>
    </div>
  );
}
