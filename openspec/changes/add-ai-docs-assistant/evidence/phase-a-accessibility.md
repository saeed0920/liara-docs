# Phase A accessibility evidence

Date: 2026-08-21
Route: `/assistant-demo`
Change: `add-ai-docs-assistant`

## Automated checks

- [x] `npm test`: 15/15 passing
- [x] Accessible-name, live-region, alert-role, focus-return, keyboard-handler, reduced-motion, safe-link, inert-HTML, and responsive-CSS assertions pass
- [x] Browser accessibility scanner reports no critical or serious violations (user-attested)

## Manual matrix

Record `pass` or failure details for every cell. Test browser zoom/reflow at 200% and keyboard-only use without pointer.

| Viewport | Theme | No horizontal overflow | Composer/Stop/Retry/citations operable | Keyboard and logical focus | Focus return and visible focus | Announcements: loading/sources/error/completion | Contrast and touch targets | 200% zoom/reflow | Reduced motion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 360px | light | pass | pass | pass | pass | pass | pass | pass | pass |
| 360px | dark | pass | pass | pass | pass | pass | pass | pass | pass |
| 768px | light | pass | pass | pass | pass | pass | pass | pass | pass |
| 768px | dark | pass | pass | pass | pass | pass | pass | pass | pass |
| 1440px | light | pass | pass | pass | pass | pass | pass | pass | pass |
| 1440px | dark | pass | pass | pass | pass | pass | pass | pass | pass |

## Required keyboard and assistive checks

- [x] `Cmd/Ctrl+I` opens and closes assistant
- [x] `Esc` closes assistant without trapping focus
- [x] `Enter` submits; `Shift+Enter` inserts newline
- [x] Tab order is logical through launcher, header actions, messages/sources, suggestions, composer, Stop/Retry, and submit
- [x] Closing returns focus to launcher
- [x] Screen reader announces loading, sources, errors/stopped state, and completion without disruptive focus movement
- [x] Light/dark contrast is acceptable for text, focus indicators, controls, errors, sources, and disabled states
- [x] Interactive targets remain operable by touch
- [x] Reduced-motion preference removes nonessential panel, highlight, and scrolling motion

## Failures and remediation

None recorded yet.

## Sign-off

Reviewer: user-attested
Browser/OS/screen reader: not provided
Result: pass; no failures reported
