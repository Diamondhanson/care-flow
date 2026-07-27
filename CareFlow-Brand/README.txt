CareFlow — Brand & Visual Identity  ·  v1.0  ·  July 2026
==========================================================

Tagline:  Every patient, every stage, in one view.
Accent :  Signal Cyan  #17C7D6  (with tints #3DDBE8 / #0FB0C0)
Type   :  Geist Sans (wordmark + UI), Geist Mono (metrics/IDs)

START HERE
----------
  CareFlow-Brand-Guidelines.html   One-page usage guide (open in any browser).
  CareFlow-Brand-Guidelines.pdf    Same guide, print/PDF.

FOLDERS
-------
logo/      Primary combination mark (symbol + "CareFlow"), SVG + PNG@3x.
             *-primary-light  — for the #F8FAFC canvas (slate wordmark)
             *-primary-dark   — for the #020618 canvas (white wordmark)
             *-tagline-*      — lockup with the tagline
             *-mono-slate     — single-colour slate (exported reports, one-ink)
             *-mono-white     — single-colour white (reversed)

symbol/    Icon-only mark (the "C" channel + node), SVG + PNG.
             *-color / *-mono-slate / *-mono-white / *-teal

app-icons/ PWA / home-screen icons on the deep-slate tile.
             careflow-appicon-192.png            192×192
             careflow-appicon-512.png            512×512
             careflow-appicon-maskable-512.png   512×512, mark inside 80% safe zone
             careflow-apple-touch-180.png        180×180, opaque
             (+ matching .svg sources)

favicon/   careflow-favicon.svg   scalable
             careflow-favicon-16/32/48.png
             careflow-favicon-tile-*  slate-tile alternative for light tabs

tokens/    careflow-brand-tokens.css    CSS custom properties
             careflow-brand-tokens.json   machine-readable tokens + a11y notes

fonts/     Geist Sans + Geist Mono (SIL Open Font License). The wordmark in the
           logo files is already outlined, so the logos need no font installed.

COLOUR SYSTEM (unchanged app palette + one accent)
--------------------------------------------------
  Signal Cyan 500  #17C7D6   the brand accent (signature, NOT the action colour)
  Signal Cyan 400  #3DDBE8   node / highlight / accent on the dark canvas
  Signal Cyan 600  #0FB0C0   logo channel / hover / accent on the light canvas
  Slate            #0F172B   text on light + the primary action colour (unchanged)

  The accent was checked in CIELAB against every reserved stage & triage colour,
  including simulated red-green colour-blindness. It stays clearly separated from
  all of them (nearest triage ΔE ≈ 16; nearest clinical colour ΔE ≈ 19) and is
  never red / orange / amber / green. Never use it for clinical meaning.

WEB SNIPPET
-----------
  <link rel="icon" href="/careflow-favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/careflow-favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/careflow-apple-touch-180.png">
  manifest icons: 192, 512, and 512 maskable (purpose:"maskable").
