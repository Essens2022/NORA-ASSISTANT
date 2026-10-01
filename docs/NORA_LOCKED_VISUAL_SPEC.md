# NORA — Locked Visual Source of Truth

Status: **APPROVED REFERENCE — DO NOT REINTERPRET**

This document locks the exact production direction approved by the founder. Future UI work must reproduce this visual language and screen structure, rather than inventing a new interpretation.

## Global visual language
- Dark cinematic navy/black background.
- High contrast white primary text, cool gray secondary text.
- Blue → violet gradients only for emphasis, active states and primary actions.
- Compact, premium cards with soft rounded corners and restrained borders.
- No oversized empty spacing.
- No floating bottom bar with content visible behind it.
- Bottom navigation is fixed, stable and visually integrated.
- Icons are simple, clean and consistent.
- Typography: Inter / system equivalent, strong hierarchy, compact labels.
- Every screen must feel like the same product.

## 1. Home
- Header: NORA wordmark left, compact settings/profile action right.
- Large central blue/violet microphone orb is the hero.
- Listening copy directly below orb: “Ti ascolto” / localized equivalent.
- Supporting copy below, short and low-contrast.
- Six compact quick actions in a 3 × 2 grid:
  - Reminder
  - Calendar
  - Activity
  - Note
  - Message
  - More
- No oversized briefing card dominating the page.
- Bottom nav: Home, Calendar, Activity, Memory, Profile.
- Home selected with blue highlight.

## 2. Calendar
- Title at top.
- Segmented mode control: Today / Week / Month.
- Compact date strip.
- Vertical agenda with time column and rounded event cards.
- Events use small category icon + title + secondary text.
- Floating + action bottom-right above nav.
- Bottom nav remains fixed and identical to Home.

## 3. Activity
- Title at top.
- Filter tabs: All / Today / Completed.
- Compact task rows:
  - completion control on left
  - icon
  - task title + time
  - reminder/bell action on right
- Primary “Add activity” CTA near bottom.
- No oversized cards or scattered form layout.

## 4. Memory
- Title at top.
- Search field directly under title.
- Filter chips: All / Notes / Conversations / Photos.
- Memory items in compact stacked cards.
- Category icon left, title and context center, metadata secondary.
- No large empty blocks.

## 5. Profile
- Title at top.
- Compact NORA identity card.
- Settings presented as native-style list rows, not large form blocks.
- Rows include:
  - Language
  - AI voice
  - Notifications
  - Reminders
  - Calendar
  - Devices
  - Appearance
  - Privacy & data
  - Help & support
- Value or state appears on the right.
- Chevron only when the row opens another screen.
- Everything must be visually compact and scan-friendly.

## 6. Push notifications
Desired content hierarchy:
- App icon is already visible; do **not** repeat “NORA” inside the notification content.
- Primary line: ACTION, visually emphasized by iOS.
- Secondary line: time only.
- Examples:
  - BEA CAFEAUA ☕️
    15:42
  - IA PASTILELE 💊
    09:00
- Forbidden copy:
  - “Ion, e momentul…”
  - “from NORA” as app-generated text
  - “Tocca per le opzioni”
  - explanatory sentences
- Note: iOS may add its own Web Push attribution. The app must not add another one.

## 7. Listening state
- Same microphone orb, visually intensified.
- Copy: “Ti ascolto” / localized equivalent.
- Minimal text below.
- No extra panels during active listening unless functionally required.

## 8. Light mode
- Same geometry, hierarchy and component structure.
- Light mode changes surfaces and contrast only; it does not redesign layout.

## Interaction requirements
- Every visible control must be functional in production.
- No decorative fake buttons.
- Navigation must preserve state and scroll.
- Touch targets must remain usable on iPhone.
- Safe areas must be respected.
- Layout must work on short iPhones without overlapping the bottom nav.
- Keyboard must never push the whole Home screen off-canvas.
- Loading, empty, disabled, error and offline states must use the same design system.
- Task detail, create/edit task, confirmation sheets, onboarding, sign-in, reminder full-screen alert, dialogs, toasts and settings sub-flows must also be brought into this exact visual language.

## Acceptance rule
A production screen is not considered complete until:
1. visual structure matches the approved reference,
2. spacing and hierarchy are consistent,
3. every control works,
4. iPhone safe-area/keyboard behavior is correct,
5. CI passes,
6. no unrelated functionality regresses.

No new visual interpretation should be introduced without explicit approval.
