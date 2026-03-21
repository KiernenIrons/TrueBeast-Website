# TrueBeast UI Overhaul - Handoff Document

## Getting Started on a New Machine

```bash
git clone https://github.com/KiernenIrons/TrueBeast-Website.git
cd TrueBeast-Website
git checkout ui-overhaul
npm install
npm run dev
```

Dev server runs at `http://localhost:5173`

---

## What's Been Done (Phases 0-3)

### Phase 0: Foundation
- **Vite + React 19 + TypeScript** project initialized
- **Tailwind CSS 4** with `@tailwindcss/vite` plugin
- **React Router 7** SPA with lazy-loaded routes
- Old site preserved as `old-index.html` (original homepage for reference)
- OBS overlay files copied to `public/` (untouched, served as static files)

### Phase 1: Design System
- **Untitled UI components** installed via CLI into `src/components/` (button, input, select, badge, avatar, dropdown, tabs, modal, tooltip, toggle, checkbox, textarea, slider, pagination, empty-state)
- **Shared layout**: Navigation, GradientBackground, PageLayout, Footer
- **Shared components**: GlassCard, DiscordIcon
- **Hooks**: useScrollReveal, useMouseTracking, useTheme
- **CSS**: Glass effects, animations, scroll reveal, light/dark mode all in `src/styles/globals.css`

### Phase 2: Homepage (`/`)
- Hero, About, Content (asymmetric video grid), Community (floating reviews + Discord CTA), Connect (colored social cards)
- Fully working with light/dark mode toggle

### Phase 3: Support System
- **Tech Support** (`/tech-support`) - Ticket submission form
- **Ticket Viewer** (`/ticket?id=TB-DEMO123`) - Single ticket view with conversation thread
- **My Tickets** (`/my-tickets`) - localStorage-tracked ticket list

### Remaining placeholder pages (just show page name):
- `/tools`, `/giveaways`, `/games`, `/admin`
- `/tools/resume-builder`, `/tools/multichat`, `/tools/buttonboard`, `/tools/qr-generator`, `/tools/ripple`, `/tools/socials-rotator`
- `/games/clout-clicker`

---

## What's Left (Phases 4-9)

### Phase 4: Tools Hub + Simple Tools (6 pages)
- `src/pages/Tools.tsx` - Tool directory with category filter
- `src/pages/tools/MultiChat.tsx` - Config page (chat.html stays in public/)
- `src/pages/tools/ButtonBoard.tsx` - Config page (board.html stays in public/)
- `src/pages/tools/SocialsRotator.tsx` - Config page (rotator.html stays in public/)
- `src/pages/tools/Ripple.tsx` - Multi-platform poster
- `src/pages/tools/QRGenerator.tsx` - QR code generator

### Phase 5: Complex Tools (2 pages)
- `src/pages/tools/ResumeBuilder.tsx` - Resume builder with PDF export (html2canvas + jspdf already installed)
- `src/pages/Giveaways.tsx` - Giveaway showcase

### Phase 6: Admin Dashboard
- `src/pages/Admin.tsx` - Protected route, tabs for tickets/reviews/announcements/analytics

### Phase 7: Games + Clout Clicker
- `src/pages/Games.tsx` - Games hub
- `src/pages/games/CloutClicker.tsx` - Wrap vanilla JS game in React component

### Phase 8: Polish + Performance
- Animation audit, code-splitting verification, accessibility, SEO meta tags

### Phase 9: Deployment
- Update GitHub Actions workflow, add 404.html SPA fallback

---

## Critical Things to Know

### Tailwind CSS 4 Layer System
**ALL custom CSS must be inside `@layer base` or `@layer components` in `globals.css`.**
Unlayered CSS overrides Tailwind utilities regardless of specificity. This was the cause of a major layout bug (mx-auto not working). See the comment in globals.css.

### max-width Classes
**Do NOT use named max-w classes** like `max-w-6xl`. They depend on `--container-*` CSS variables that may not resolve properly. Use **arbitrary values** instead:
- `max-w-[72rem]` instead of `max-w-6xl`
- `max-w-[80rem]` instead of `max-w-7xl`
- `max-w-[56rem]` instead of `max-w-4xl`
- etc.

### No Em-Dash Character
The user explicitly requested no em-dash character (the long dash) anywhere. Use ` - ` (space-dash-space) or `--` in comments instead.

### Glass CSS Classes
Defined in `@layer components` in `globals.css`:
- `.glass` - Standard frosted glass (blur 48px, border, shadow)
- `.glass-strong` - Heavier glass effect
- `.glass-hover` - Adds translateY(-2px) lift on hover
- `.glass-glow` - Animated gradient border via ::before pseudo-element
- `.nav-dropdown` - Specific dropdown styling for light/dark

### Light Mode
- Toggled by `html.light` class on `<html>` element
- `src/lib/theme.ts` handles sync initialization + localStorage persistence
- `useTheme()` hook for React components
- Light mode overrides are in `@layer base` in globals.css
- GradientBackground component switches gradient colors reactively
- Text colors forced with `!important` for contrast (text-white -> #111, grays -> darker)

### Firebase
- `src/lib/firebase.ts` is ported but NOT wired up to pages yet
- Pages currently use console.log / mock data for ticket operations
- Firebase config is in `src/config.ts` (SITE_CONFIG.firebase)
- Wire up in Phase 8 or incrementally per page

### Project Structure
```
src/
  main.tsx              # Entry point (React 19 createRoot + Router)
  App.tsx               # Route definitions (all lazy-loaded)
  config.ts             # SITE_CONFIG (social URLs, videos, Firebase config)
  styles/globals.css    # Tailwind imports + all custom CSS
  lib/
    theme.ts            # TBTheme + TBPerf (sync init)
    firebase.ts         # Firebase abstraction (modular SDK)
    analytics.ts        # TBAnalytics
  hooks/
    useTheme.ts         # React wrapper for TBTheme
    useScrollReveal.ts  # IntersectionObserver scroll animations
    useMouseTracking.ts # Cursor glow effect
  components/
    layout/             # Navigation, PageLayout, GradientBackground, Footer
    shared/             # GlassCard, DiscordIcon
    base/               # Untitled UI base components
    application/        # Untitled UI application components
    foundations/        # Untitled UI icons/patterns
  pages/
    Home.tsx            # DONE
    TechSupport.tsx     # DONE
    Ticket.tsx          # DONE
    MyTickets.tsx       # DONE
    Tools.tsx           # Placeholder
    Giveaways.tsx       # Placeholder
    Games.tsx           # Placeholder
    Admin.tsx           # Placeholder
    tools/              # All placeholders
    games/              # Placeholder
```

### Building Each Page
When building a new page, follow this pattern:
1. Import `PageLayout` from `@/components/layout/PageLayout`
2. Read the corresponding old HTML file (in the repo root or subdirectories) for content/functionality
3. Use glass/glass-strong CSS classes for panels
4. Use `reveal` class for scroll animations
5. Use `text-gradient` and `font-display` classes for headings
6. Use max-w-[72rem] mx-auto for main containers
7. Use lucide-react for icons
8. Keep TypeScript strict, no em-dashes

### User Preferences
- Modern, minimalistic, clean/neat/tidy design
- Smooth animations without stuttering
- Buttons that feel good to click (hover effects, transitions)
- Professional quality - "built by a team, not a random dev"
- The user is particular about contrast, spacing, and light mode readability
- Copyright year: 2026
- Tab title format: "Page Name | TrueBeast"

---

## Plan File
The full implementation plan is at `.claude/plans/validated-riding-starlight.md`
