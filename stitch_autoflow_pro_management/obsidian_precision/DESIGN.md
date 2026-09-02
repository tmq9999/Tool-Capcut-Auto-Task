---
name: Obsidian Precision
colors:
  surface: '#0a0a0a'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#171717'
  surface-container-high: '#262626'
  surface-container-highest: '#353534'
  on-surface: '#fafafa'
  on-surface-variant: '#a3a3a3'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#404040'
  outline-variant: '#434655'
  surface-tint: '#b4c5ff'
  primary: '#b4c5ff'
  on-primary: '#002a78'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#0053db'
  secondary: '#b9c8de'
  on-secondary: '#233143'
  secondary-container: '#39485a'
  on-secondary-container: '#a7b6cc'
  tertiary: '#ffb596'
  on-tertiary: '#581e00'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ef4444'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d4e4fa'
  secondary-fixed-dim: '#b9c8de'
  on-secondary-fixed: '#0d1c2d'
  on-secondary-fixed-variant: '#39485a'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
  success: '#22c55e'
  warning: '#f59e0b'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-xs:
    fontFamily: Geist
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.02em
  code:
    fontFamily: jetbrainsMono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  gutter: 16px
  sidebar: 240px
---

## Brand & Style

The design system is an ultra-modern, high-density interface designed for technical professionals and developers. By pivoting to a dark color mode, the system reduces eye strain during prolonged monitoring sessions while maintaining a high-performance, "command center" aesthetic.

The design style is **Corporate Modern with a Minimalist focus**. It leverages deep charcoal surfaces and high-contrast blue accents to create a sense of authoritative precision. The interface feels like a high-end IDE or professional monitoring suite: sleek, focused, and intentionally utilitarian. Visual hierarchy is established through subtle tonal shifts rather than decorative elements, ensuring that the data—not the interface—remains the primary focus.

## Colors

The palette is optimized for a **professional dark interface**, utilizing a deep charcoal and black foundation. 

- **Surfaces:** The base background is nearly black (`#0a0a0a`), providing the lowest possible luminance for the environment. Component containers and sidebars use a tiered charcoal scale (`#171717`, `#262626`) to create structural depth without relying on shadows.
- **Accents:** A vibrant, modern blue (`#2563eb`) serves as the primary action color, ensuring high visibility against dark backgrounds.
- **Typography:** Primary text uses an off-white (`#fafafa`) to reach AAA accessibility standards, while secondary information uses a muted gray (`#a3a3a3`) to maintain hierarchy.
- **Status:** Semantic colors (Success, Warning, Error) are adjusted for dark mode to be slightly more desaturated while remaining punchy enough to draw immediate attention.

## Typography

The system continues to utilize **Geist** for all UI elements, benefiting from its geometric clarity and readability at the small scales required for high-density data. 

- **Hierarchy:** We use a compact scale. The standard body size is 13px, ensuring that complex dashboards can display maximum information.
- **Technical Content:** **JetBrains Mono** is used for code snippets, log streams, and ID strings. This distinguishes technical data from UI labels at a glance.
- **Optimization:** In dark mode, font weights are carefully managed; SemiBold (600) is used for headers to ensure they don't "bloom" or bleed on high-brightness screens, while maintaining clear distinction from body text.

## Layout & Spacing

The layout follows a **fluid grid system** anchored by a fixed-width left navigation sidebar. 

- **Grid:** A strict 8px rhythm governs the primary layout, while a 4px sub-grid handles internal component spacing.
- **Density:** The interface is optimized for "Compact" density. Controls like inputs and buttons are normalized to a 32px height to balance clickability with screen real estate.
- **Reflow:** On smaller screens, the sidebar collapses into a thin icon rail or hides behind a drawer, allowing the primary data tables and consoles to occupy the full viewport width.

## Elevation & Depth

In this dark-themed system, depth is conveyed through **tonal layering** and **low-contrast outlines** rather than traditional shadows, which can appear muddy in dark interfaces.

- **Layering:** The further an element is "forward" in the Z-axis, the lighter its charcoal surface becomes. Level 0 is the base background (`#0a0a0a`), while Level 1 (cards/modals) uses `#171717`.
- **Borders:** All interactive containers feature a subtle 1px border (`#404040`) to define their edges against the dark background.
- **Interactions:** Hover states are signaled by a slight increase in surface lightness (tinting) rather than an elevation lift.

## Shapes

The design uses a **Rounded** (8px/0.5rem) strategy to provide a professional yet modern feel. This level of roundedness softens the technical density of the grid without making the interface appear "bubbly" or consumer-focused.

- **Standard (8px):** Primary containers, buttons, and input fields.
- **Large (16px):** Reserved for large cards or modal containers.
- **Pill:** Used exclusively for status indicators and badges to separate them visually from square-ish interactive buttons.

## Components

### Buttons
- **Primary:** Solid blue (`#2563eb`) with white text. Hover state is a subtle lightening of the blue.
- **Secondary:** Transparent background with a 1px gray border (`#404040`). Text is off-white.
- **Ghost:** No border or background. Used for low-priority actions in toolbars.

### Form Inputs
- **Fields:** Dark background (`#171717`) with a 1px border. Focus state triggers a primary blue border and a 2px outer glow to ensure the user knows exactly where the focus lies in a dark environment.
- **Selectors:** Use the same styling as inputs, with a chevron icon colored in `on-surface-variant`.

### Data Tables
- **Styling:** Row height is 36px. Headers are sticky with a slightly lighter background and a crisp bottom border.
- **States:** Hovering a row highlights it in `#262626`. Selected rows use a very subtle blue tint with a 2px solid blue left-edge indicator.

### Log Console
- **Appearance:** A deep black box (`#000000`) with a 1px border.
- **Typography:** Uses the `code` level (JetBrains Mono). Timestamps are muted, while log levels (INFO, WARN, ERR) use their respective semantic colors for quick scanning.

### Feedback
- **Toasts:** These should be the brightest elements on the screen, using a Level 2 surface (`#262626`) and strong colored accents to ensure they are noticed immediately.
- **Progress:** A thin 4px line using the primary blue for the fill and a dark gray for the track.