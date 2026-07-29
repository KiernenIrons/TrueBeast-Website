/* ============================================================
   Trading Card Game — OBS Overlay
   Add this page's URL as a Browser Source in OBS. Transparent
   background, no nav/footer. Purely reactive to Firestore: the
   instant the Worker writes a packEvents doc, it plays here.
   ============================================================ */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import gsap from 'gsap';
import { CARDS_CONFIG } from '@/cards/config';
import { subscribeToPackEvents, getCardCatalog } from '@/cards/db';
import type { PackEvent, CardDef } from '@/cards/types';
import CardFace from '@/cards/CardFace';

export default function CardsOverlay() {
  const [currentEvent, setCurrentEvent] = useState<PackEvent | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CardDef[]>([]);

  const queueRef = useRef<PackEvent[]>([]);
  const playingRef = useRef(false);
  const packRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      setCurrentEvent(null);
      setLabel(null);
      return;
    }
    playingRef.current = true;
    setLabel(`${next.twitchUserDisplayName || next.twitchUserLogin} opened a pack!`);
    setCurrentEvent(next);
  }, []);

  useEffect(() => {
    getCardCatalog().then(setCatalog);
  }, []);

  // Subscribe to new pack events (only ones created after this overlay loaded).
  useEffect(() => {
    const sinceIso = new Date().toISOString();
    const unsubscribe = subscribeToPackEvents(sinceIso, (event) => {
      queueRef.current.push(event);
      if (!playingRef.current) playNext();
    });
    return unsubscribe;
  }, [playNext]);

  // Whenever a new event is staged, run the full GSAP reveal sequence.
  useEffect(() => {
    if (!currentEvent) return;
    const cards: CardDef[] = currentEvent.cardIds
      .map((id) => catalog.find((c) => c.id === id))
      .filter((c): c is CardDef => !!c);
    if (cards.length === 0) {
      playNext();
      return;
    }

    const pack = packRef.current;
    const flash = flashRef.current;
    const tl = gsap.timeline({ onComplete: playNext });

    if (pack) {
      tl.set(pack, { opacity: 1, x: 500, scale: 0.75, rotateY: 0 });
      tl.to(pack, { x: 0, duration: 0.55, ease: 'power3.out' });
      tl.to(pack, { rotateY: 180, duration: 0.5, ease: 'power1.inOut' }, '+=0.2');
      tl.to(pack, { scale: 1.2, duration: 0.25, ease: 'power2.out' });
      if (flash) tl.set(flash, { opacity: 0 }, '<');
      tl.to(
        pack,
        { opacity: 0, scale: 1.5, duration: 0.3, ease: 'power2.in' },
        '+=0.05',
      );
      if (flash) tl.to(flash, { opacity: 0.85, duration: 0.12, yoyo: true, repeat: 1 }, '<');
    }

    cards.forEach((_, i) => {
      const el = cardRefs.current[i];
      if (!el) return;
      const tilt = i % 2 === 0 ? -8 : 8;
      tl.fromTo(
        el,
        { opacity: 0, scale: 0.25, y: 50, rotateZ: tilt },
        { opacity: 1, scale: 1, y: 0, rotateZ: 0, duration: 0.5, ease: 'back.out(1.6)' },
      );
      tl.to({}, { duration: CARDS_CONFIG.revealDurationSeconds }); // hold on screen
      tl.to(el, { opacity: 0, x: -320, rotateZ: -18, duration: 0.4, ease: 'power2.in' });
    });

    return () => {
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent, catalog, playNext]);

  const cards: CardDef[] = currentEvent
    ? currentEvent.cardIds
        .map((id) => catalog.find((c) => c.id === id))
        .filter((c): c is CardDef => !!c)
    : [];

  return (
    <div className="fixed inset-0 overflow-hidden bg-transparent">
      <Helmet>
        <title>Cards Overlay</title>
      </Helmet>

      <div
        ref={flashRef}
        className="pointer-events-none absolute inset-0 bg-white"
        style={{ opacity: 0 }}
      />

      {label && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20">
          <div className="glass-strong rounded-full px-6 py-2 text-white font-semibold text-lg shadow-lg">
            {label}
          </div>
        </div>
      )}

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ perspective: 1000 }}
      >
        <div
          ref={packRef}
          className="absolute rounded-2xl flex items-center justify-center"
          style={{
            width: 220,
            height: 300,
            background: 'linear-gradient(155deg, #22c55e 0%, #052e16 100%)',
            border: '3px solid #4ade80',
            boxShadow: '0 0 40px rgba(74,222,128,0.5), 0 12px 32px rgba(0,0,0,0.4)',
            opacity: 0,
          }}
        >
          <span style={{ fontSize: 72 }}>📦</span>
        </div>

        <div className="absolute inset-0 flex items-center justify-center gap-6">
          {cards.map((card, i) => (
            <div
              key={`${currentEvent?.id}-${card.id}-${i}`}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className="absolute"
              style={{ opacity: 0 }}
            >
              <CardFace card={card} size="lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
