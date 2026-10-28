---
name: Codeforces to GitHub Sync Design System
description: Technical, trustworthy, high-density developer design system for competitive programming solution sync
colors:
  bg-canvas-dark: "#090d12"
  bg-surface-dark: "#141b24"
  bg-surface-raised-dark: "#1a2330"
  border-subtle-dark: "#1e2837"
  border-default-dark: "#2a374a"
  text-primary-dark: "#f1f5f9"
  text-secondary-dark: "#94a3b8"
  text-muted-dark: "#64748b"
  accent-dark: "#38bdf8"
  success-dark: "#34d399"
  warning-dark: "#fbbf24"
  danger-dark: "#f87171"
  contest-dark: "#818cf8"
  bg-canvas-light: "#f8fafc"
  bg-surface-light: "#ffffff"
  text-primary-light: "#0f172a"
  accent-light: "#0284c7"
typography:
  display:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: "3px"
  sm: "5px"
  md: "7px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-dark}"
    textColor: "#042f44"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary-dark}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "32px"
---

# Design System

## Overview
Codeforces → GitHub Sync uses an obsidian slate developer aesthetic engineered for competitive programmers. The interface balances high information density with exceptional legibility, pairing modern system sans typography for clear hierarchies with monospace tabular numerals for contest IDs, submission counts, problem ratings, and Git blob SHAs.

Both the extension popup and full dashboard share a single tokenized design system supporting dark and light color modes, zero decorative clutter, and strict contrast compliance.

## Colors
- **Canvas (`--bg-canvas`):** Deep technical obsidian `#090d12` (dark) / `#f8fafc` (light).
- **Surface (`--bg-surface`):** Clean card background `#141b24` (dark) / `#ffffff` (light).
- **Accent Cyan (`--accent`):** Electric Sky `#38bdf8` (dark) / `#0284c7` (light) for primary actions, active filters, and interactive highlights.
- **AC Green (`--success`):** `#34d399` (dark) / `#059669` (light) for Accepted/Uploaded solution badges.
- **Warning Amber (`--warning`):** `#fbbf24` (dark) / `#d97706` (light) for paused synchronizations and skipped submissions.
- **Error Coral (`--danger`):** `#f87171` (dark) / `#dc2626` (light) for failure logs and critical alerts.
- **Contest Indigo (`--contest`):** `#818cf8` (dark) / `#4f46e5` (light) for Contest Protection statuses and safe holding queues.

## Typography
- **Primary Interface Face:** Modern system sans (`ui-sans-serif`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`).
- **Data & Measurement Voice:** Strict monospace (`ui-monospace`, `JetBrains Mono`, `SF Mono`, `Consolas`).
- **Tabular Figures:** All counts, timestamps, submission IDs, and contest numbers enforce `font-variant-numeric: tabular-nums` to maintain precise vertical columns across data tables and metric boxes.

## Layout
- **Compact Browser Popup:** Fixed 384px width, auto height (480px to 600px max) with sticky header, status hero card, account row, and compact action footer.
- **Full Dashboard:** 1360px max width, responsive two-column and grid layouts, tabbed navigation bar for modular workflows (`Overview`, `Submission History`, `Selective Sync`, `Repository`, `Security & Vault`, `Diagnostics`).

## Elevation & Depth
- Soft, realistic depth shadows (`0 1px 3px rgba(0,0,0,0.12)`, `0 4px 12px rgba(0,0,0,0.15)`).
- Zero-offset halos and harsh neobrutalist block shadows are prohibited.

## Shapes
- Crisp, technical corner radii (3px for chips, 5px for inputs and buttons, 7px for panels). No oversized circular bubble cards.

## Components
- **Status Hero Card:** Communicates live phase (`SYNCING`, `UP TO DATE`, `PAUSED`, `ATTENTION`), animated progress bar, metric counters, and one-click sync controls.
- **Contest Protection Module:** Explicit visual state machine reflecting real extension queue state (Normal Sync → Uploads Paused → Queue Staged → Processing).
- **History Data Table:** Monospace problem keys, direct links to Codeforces submissions and GitHub files, explicit reason columns for skipped or failed attempts.
- **Filter Selector Cards:** Dedicated cards with clickable tag and language chips for rapid configuration.

## Do's and Don'ts
- **DO** use `font-variant-numeric: tabular-nums` for all stats, timestamps, ratings, and IDs.
- **DO** tint secondary text from the background hue rather than neutral gray to preserve high contrast (>= 4.5:1).
- **DO** use drawn SVG icons with unified 2px stroke weight.
- **DON'T** use eyebrows/kickers above headings.
- **DON'T** use gradient text or decorative glassmorphism.
- **DON'T** use unicode emojis in place of icons.
- **DON'T** clobber or delete previously synchronized files when filters are modified.
