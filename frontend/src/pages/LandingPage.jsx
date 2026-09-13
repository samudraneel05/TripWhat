import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Compass, ArrowUp, ArrowUpRight, ArrowRight, MapPin, Play, Sparkles, Bookmark, SlidersHorizontal, Plane, BedDouble, Utensils, Check, Plus } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { TripWalkthrough } from "../components/landing/TripWalkthrough";
import { HeroGlobe } from "../components/landing/HeroGlobe";
import { CyclingPrompt } from "../components/landing/CyclingPrompt";
import { useHeroAnimation } from "../components/landing/useHeroAnimation";
import { useScrollReveal } from "../components/landing/useScrollReveal";
import "./LandingPage.css";

const SUGGESTIONS = [
  { label: "Paris", sub: "Cafés, art & a little wandering", days: "3 days", img: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=640&h=720&fit=crop&auto=format" },
  { label: "Tokyo", sub: "Small streets, big discoveries", days: "7 days", img: "https://images.unsplash.com/photo-1554797589-7241bb691973?w=640&h=720&fit=crop&auto=format" },
  { label: "Bali", sub: "Slow mornings by the sea", days: "5 days", img: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=640&h=720&fit=crop&auto=format" },
  { label: "Iceland", sub: "Take the scenic route", days: "6 days", img: "https://images.unsplash.com/photo-1733152799246-41e02b5428a0?w=640&h=720&fit=crop&auto=format" },
];

const GLOBE_DESTINATIONS = [
  { ...SUGGESTIONS[0], coordinates: [2.35, 48.86] },
  { ...SUGGESTIONS[1], coordinates: [139.69, 35.69] },
  { ...SUGGESTIONS[2], coordinates: [115.2, -8.4] },
  { ...SUGGESTIONS[3], coordinates: [-19, 64.8] },
  { label: "New York", img: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=200&h=200&fit=crop", coordinates: [-74, 40.71] },
  { label: "Coastal escapes", img: "/coastal-road-trip-scenic-view.jpg", coordinates: [-155.6, 19.9] },
  { label: "Mountain stays", img: "/mountain-hotel-stay.jpg", coordinates: [10.5, 46.7] },
  { label: "Market mornings", img: "/local-food-market.jpg", coordinates: [-9.14, 38.72] },
  { label: "Rio", img: "https://images.unsplash.com/photo-1772603503638-74ca65f96589?w=200&h=200&fit=crop&auto=format", coordinates: [-43.2, -22.9] },
  { label: "Sydney", img: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=200&h=200&fit=crop&auto=format", coordinates: [151.2, -33.9] },
  { label: "Cape Town", img: "https://images.unsplash.com/photo-1724136620561-99a60d12f98b?w=200&h=200&fit=crop&auto=format", coordinates: [18.4, -33.9] },
  { label: "Buenos Aires", img: "https://images.unsplash.com/photo-1486325212027-8081e485255e?w=200&h=200&fit=crop&auto=format", coordinates: [-58.4, -34.6] },
  { label: "Lima", img: "https://images.unsplash.com/photo-1660521844005-015733ce411e?w=200&h=200&fit=crop&auto=format", coordinates: [-77.0, -12.0] },
  { label: "Jaipur", img: "https://images.unsplash.com/photo-1605649487212-47bdab064df7?w=200&h=200&fit=crop&auto=format", coordinates: [75.8, 26.9] },
  { label: "Marrakech", img: "https://images.unsplash.com/photo-1517760444937-f6397edcbbcd?w=200&h=200&fit=crop&auto=format", coordinates: [-8.0, 31.6] },
  { label: "Nairobi", img: "https://images.unsplash.com/photo-1741991110666-88115e724741?w=200&h=200&fit=crop&auto=format", coordinates: [36.8, -1.3] },
];

const STARTERS = [
  { label: "A weekend in Paris", prompt: "Plan a relaxed 3-day trip to Paris with cafés, art, and time to wander." },
  { label: "A first trip to Japan", prompt: "Help me plan my first 7-day trip to Japan, visiting Tokyo and Kyoto." },
  { label: "Somewhere by the sea", prompt: "Where should I go for a quiet 5-day beach trip? I love local food and small towns." },
];

const RESEARCH = [
  { icon: Plane, title: "Getting there", text: "Compare flight options around your dates, departure city, and budget.", action: "Find a flight", prompt: "Help me find flights for my next trip. Ask me where and when I want to go." },
  { icon: BedDouble, title: "Somewhere to stay", text: "Find hotels near the places you want to be, not just a pin in the city center.", action: "Explore stays", prompt: "Help me find a hotel for my next trip that fits my budget and the places I want to visit." },
  { icon: Utensils, title: "The good little details", text: "Discover the cafés, neighborhood spots, and experiences that make a trip yours.", action: "Find things to do", prompt: "Help me discover local food, cafés, and interesting things to do on my next trip." },
];

export default function LandingPage() {
  const [query, setQuery] = useState("");
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const composerRef = useRef(null);
  const heroRef = useRef(null);
  const [animationPaused, setAnimationPaused] = useState(false);
  const [promptFocused, setPromptFocused] = useState(false);
  const { running, reducedMotion } = useHeroAnimation(heroRef, animationPaused || promptFocused || query.length > 0);
  const scrollRef = useScrollReveal();

  const startTrip = (prompt) => {
    const message = prompt.trim();
    if (!message || loading) return;
    navigate(`${isAuthenticated ? "/new" : "/signup"}?q=${encodeURIComponent(message)}`);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    startTrip(query);
  };

  const handleSuggestion = (label) => {
    const destination = SUGGESTIONS.find((suggestion) => suggestion.label === label);
    startTrip(`Plan a ${destination.days.replace(" days", "-day")} trip to ${label}`);
  };

  const focusComposer = () => {
    composerRef.current?.focus({ preventScroll: true });
  };

  const authQuery = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";

  return (
    <div className="landing" id="top" ref={scrollRef}>
      <a className="landing-skip" href="#trip-prompt" onClick={focusComposer}>Skip to trip planner</a>
      {/* Minimal top bar */}
      <header className="landing-header">
        <Link to="/" className="landing-brand" aria-label="TripWhat home">
          <Compass size={20} strokeWidth={1.7} aria-hidden="true" />
          <span>TripWhat<span className="landing-brand-dot">.</span></span>
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#possibilities">What you can plan</a>
          <a href="#destinations">Get inspired</a>
        </nav>
        <div className="landing-auth">
          {isAuthenticated ? (
            <Link to="/trips" className="landing-button landing-button-dark">My trips <ArrowUpRight size={15} aria-hidden="true" /></Link>
          ) : (
            <>
              <Link to={`/login${authQuery}`} className="landing-login">Log in</Link>
              <Link to={`/signup${authQuery}`} className="landing-button landing-button-dark">Get started <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </>
          )}
        </div>
      </header>

      <main>
        {/* Centered composer */}
        <section ref={heroRef} className="landing-hero" aria-labelledby="landing-title" data-motion={running ? "playing" : "paused"}>
          <svg className="landing-world" viewBox="0 0 1200 530" fill="none" aria-hidden="true">
            <defs>
              <pattern id="landing-dots" width="11" height="11" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.35" fill="currentColor" /></pattern>
            </defs>
            <g fill="url(#landing-dots)">
              <path d="M65 93 143 49 233 57 269 99 344 117 320 156 269 168 244 223 207 250 183 207 140 184 107 135 60 126Z" />
              <path d="M249 247 300 252 351 285 369 327 331 380 308 441 271 478 251 420 258 369 227 310Z" />
              <path d="M343 49 410 28 435 73 407 117 353 101Z" />
              <path d="M510 115 550 79 600 65 651 101 674 148 643 172 606 164 579 187 533 169Z" />
              <path d="M534 197 595 171 657 199 683 244 653 303 612 350 574 338 564 287 523 249Z" />
              <path d="M656 76 754 52 861 69 942 50 1080 112 1141 154 1071 195 1000 177 967 218 927 236 902 292 863 270 831 225 803 265 775 234 743 202 678 178Z" />
              <path d="M953 350 1018 315 1089 341 1110 391 1061 423 1000 412 965 384Z" />
              <path d="M899 291 941 298 960 311 949 325 911 318Z M1128 422 1148 442 1127 475 1114 460Z M1084 210 1095 227 1075 256 1064 247Z" />
            </g>
          </svg>
          <div className="landing-hero-content">
            <span className="landing-eyebrow"><span className="landing-status-dot" /> A little curiosity. A whole new trip.</span>
            <h1 id="landing-title">Less planning.<br /><em>More going.</em></h1>
            <p className="landing-intro">Your next adventure starts with a single conversation.</p>

            {/* Composer */}
            <form className="landing-composer" onSubmit={handleSubmit} aria-label="Plan your trip">
              <label htmlFor="trip-prompt" className="sr-only">Tell us about your trip</label>
              <div className="landing-prompt-field" data-example-visible={!query && !promptFocused}>
                <textarea
                  ref={composerRef}
                  id="trip-prompt"
                  rows={2}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setPromptFocused(true)}
                  onBlur={() => setPromptFocused(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      startTrip(query);
                    }
                  }}
                  placeholder="Tell us where you’d like to go…"
                />
                <CyclingPrompt running={running} reducedMotion={reducedMotion} hidden={!!query || promptFocused} />
              </div>
              <div className="landing-composer-bottom">
                <span><Sparkles size={14} aria-hidden="true" /> Big plans or just a daydream</span>
                <button className="landing-button landing-button-orange" type="submit" disabled={!query.trim() || loading}>
                  Explore <ArrowUp size={17} aria-hidden="true" />
                </button>
              </div>
            </form>
            <div className="landing-starters" aria-label="Try a trip idea">
              {STARTERS.map((starter) => (
                <button key={starter.label} onClick={() => { setQuery(starter.prompt); focusComposer(); }}>
                  {starter.label} <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
            <a className="landing-tour-link" href="#how-it-works"><span><Play size={11} fill="currentColor" aria-hidden="true" /></span> Take a walkthrough <span className="landing-tour-note">No sign-up needed</span></a>
          </div>
          <HeroGlobe running={running} destinations={GLOBE_DESTINATIONS} />
          <div className="landing-hero-foot"><span>LESS TAB-HOPPING</span><span className="landing-tiny-line" /><span>MORE LOOKING FORWARD</span></div>
        </section>

        <div className="landing-benefits" aria-label="TripWhat features">
          <span><MapPin size={16} aria-hidden="true" /> Real places to discover</span>
          <span><Compass size={16} aria-hidden="true" /> Your own day-by-day plan</span>
          <span><Bookmark size={16} aria-hidden="true" /> All your favorites together</span>
          <span><SlidersHorizontal size={16} aria-hidden="true" /> Change plans as you go</span>
        </div>

        <section id="how-it-works" className="landing-section landing-walkthrough" aria-labelledby="walkthrough-title">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">FROM “WHAT IF” TO “LET’S GO”</span>
            <h2 id="walkthrough-title">One conversation.<br />A trip that feels like you.</h2>
            <p>Try a little Paris trip. See how an idea becomes a plan,<br className="landing-desktop-break" /> then make a change of your own.</p>
          </div>
          <TripWalkthrough onStart={startTrip} />
          <a className="landing-text-link landing-skip-tour" href="#trip-prompt" onClick={focusComposer}>Already have a trip in mind? Start planning <ArrowRight size={14} aria-hidden="true" /></a>
        </section>

        <section className="landing-stories" aria-label="A different way to plan">
          <article className="landing-story">
            <div className="landing-story-copy">
              <span className="landing-eyebrow">FOLLOW YOUR CURIOSITY</span>
              <h2>Ask a question.<br />Find your kind of place.</h2>
              <p>The best trips start with a small idea. A food market worth getting up for. A quiet neighborhood. A hotel with a view. Ask TripWhat, and keep exploring from there.</p>
              <button className="landing-text-link" onClick={() => startTrip("Help me find interesting local markets and food experiences for my next trip.")} disabled={loading}>Find something you’ll love <ArrowRight size={15} aria-hidden="true" /></button>
            </div>
            <div className="landing-photo-panel landing-market">
              <img src="/local-food-market.jpg" alt="A bustling outdoor market with produce stalls and cafés" width="1024" height="1024" loading="lazy" />
              <div className="landing-mini-chat">
                <span className="landing-demo-label">AN EXAMPLE CONVERSATION</span>
                <div className="landing-mini-question">“Less sightseeing, more local food.”</div>
                <div className="landing-mini-answer"><Compass size={20} aria-hidden="true" /><span>That sounds like a market morning.<br /><strong>Let’s find your next favorite spot.</strong></span></div>
                <div className="landing-mini-tags"><span>Food markets</span><span>Neighborhood cafés</span></div>
              </div>
            </div>
          </article>
          <article className="landing-story landing-story-reverse">
            <div className="landing-story-copy">
              <span className="landing-eyebrow">YOUR PACE. YOUR PRIORITIES.</span>
              <h2>A plan, not<br />a packed schedule.</h2>
              <p>Tell us what matters: your budget, who’s coming, and how you like to travel. Keep the places you love, move things around, and leave a little space for the unexpected.</p>
              <a className="landing-text-link" href="#how-it-works">See how it comes together <ArrowRight size={15} aria-hidden="true" /></a>
            </div>
            <div className="landing-photo-panel landing-stay">
              <img src="/mountain-hotel-stay.jpg" alt="A peaceful hotel room looking out over snowy mountains" width="1024" height="1024" loading="lazy" />
              <div className="landing-preferences">
                <span className="landing-demo-label">A TRIP THAT’S YOURS</span>
                <h3>How do you like to travel?</h3>
                <div><span><Check size={13} aria-hidden="true" /> Slow mornings</span><span><Check size={13} aria-hidden="true" /> Local food</span><span><Check size={13} aria-hidden="true" /> A little outdoors</span></div>
                <p>More of what you love. Less of everything else.</p>
              </div>
            </div>
          </article>
        </section>

        <section id="possibilities" className="landing-section landing-research" aria-labelledby="research-title">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">THE WHOLE TRIP, IN ONE PLACE</span>
            <h2 id="research-title">From the first flight<br />to the last little detour.</h2>
          </div>
          <div className="landing-research-grid">
            {RESEARCH.map(({ icon: Icon, title, text, action, prompt }) => (
              <article key={title}>
                <span className="landing-feature-icon"><Icon size={23} strokeWidth={1.5} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{text}</p>
                <button className="landing-text-link" onClick={() => startTrip(prompt)} disabled={loading}>{action} <ArrowUpRight size={15} aria-hidden="true" /></button>
              </article>
            ))}
          </div>
        </section>

        {/* Destination suggestions */}
        <section id="destinations" className="landing-section landing-destinations" aria-labelledby="destinations-title">
          <div className="landing-destinations-heading">
            <div><span className="landing-eyebrow">A LITTLE INSPIRATION</span><h2 id="destinations-title">Where could you go?</h2></div>
            <p>Pick a starting point.<br />We’ll help you make it your own.</p>
          </div>
          <div className="landing-destination-grid">
            {SUGGESTIONS.map((destination) => (
              <button key={destination.label} className="landing-destination" onClick={() => handleSuggestion(destination.label)} disabled={loading} aria-label={`Plan a trip to ${destination.label}`}>
                <div className="landing-destination-image">
                  <img src={destination.img} alt={`${destination.label} travel inspiration`} width="200" height="200" loading="lazy" />
                  <span className="landing-destination-days">{destination.days}</span>
                  <span className="landing-destination-arrow"><ArrowUpRight size={19} aria-hidden="true" /></span>
                </div>
                <h3>{destination.label}</h3><p>{destination.sub}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="landing-section landing-faq" aria-labelledby="faq-title">
          <div><span className="landing-eyebrow">BEFORE YOU SET OFF</span><h2 id="faq-title">A few good questions.</h2></div>
          <div className="landing-questions">
            {[
              ["Do I need to know where I’m going?", "Not yet. Tell TripWhat the kind of trip you’re imagining, your interests, or when you’d like to go. You can explore ideas before settling on a destination."],
              ["What happens when I enter a trip idea?", "If you’re signed out, we’ll ask you to create an account or log in. Your message comes with you, and starts a new conversation after you sign in. No retyping."],
              ["Can I change the itinerary?", "Yes. Ask for changes in chat, or use the itinerary controls to add places, remove activities, move them between days, and adjust times."],
              ["Does TripWhat book the trip for me?", "TripWhat helps you research and organize your trip. You complete reservations with the provider. Always confirm prices, availability, and opening times before you go."],
            ].map(([question, answer]) => (
              <details key={question}><summary>{question}<Plus size={17} aria-hidden="true" /></summary><p>{answer}</p></details>
            ))}
          </div>
        </section>

        <section className="landing-finale" aria-labelledby="finale-title">
          <Compass size={36} strokeWidth={1.1} aria-hidden="true" />
          <span className="landing-eyebrow">THE BEST PART IS STILL AHEAD</span>
          <h2 id="finale-title">Got a somewhere<br /><em>in mind?</em></h2>
          <a className="landing-button landing-button-orange" href="#trip-prompt" onClick={focusComposer}>Let’s plan it <ArrowUpRight size={16} aria-hidden="true" /></a>
          <p>Start with a sentence. See where it takes you.</p>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div><Link to="/" className="landing-brand"><Compass size={23} strokeWidth={1.7} aria-hidden="true" /><span>TripWhat<span className="landing-brand-dot">.</span></span></Link><p>Your curiosity. Your pace. Your trip.</p></div>
        <nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#destinations">Destinations</a><Link to={isAuthenticated ? "/trips" : `/signup${authQuery}`}>{isAuthenticated ? "My trips" : "Start planning"}</Link></nav>
        <span className="landing-copyright">© {new Date().getFullYear()} TripWhat</span>
      </footer>
    </div>
  );
}
