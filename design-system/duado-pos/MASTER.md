# Duado POS: Design System "Dapur Pedas" (v2.0 reset)

Source of truth for `web/css/app.css`. Hand-written to the ui-ux-pro-max MASTER.md convention
(the skill's generator and databases were not available when this was made, so nothing here is
a database match; it is derived from the product and the skill's priority checklist).

## Product context
Cashier POS for a spicy-snack shop. Used one-handed on a phone (portrait) or tablet, in a busy,
often bright shop, by non-technical staff; the Owner reads dashboards on the same device.
Speed of the tap and the legibility of money matter more than decoration.

## Principles
1. **Money is the hero.** Every amount uses tabular numerals; totals are the largest text on a screen.
2. **Color has a job.** Yellow = the one primary action. Maroon = structure and brand. Chili orange = heat and
   attention (small areas only). Green / amber / red = status only, never decoration.
3. **Flat with hairlines.** Surfaces are separated by 1px lines. Elevation (shadow) is reserved for layers that
   float over content: cart bar, bottom sheet, toast.
4. **Reachable.** Primary controls sit in the lower half and are at least 48px tall; nothing tappable is under 44px.
5. **Quiet motion.** Motion confirms an action (120 to 280 ms, transform/opacity only) and is removed for reduced-motion users.

## Tokens
| Group | Token | Value | Use |
|---|---|---|---|
| Brand | `--brand` | #5B1A14 | header, hero, selected chip, brand text |
| | `--brand-hi` | #7A271D | gradients, hover |
| | `--brand-deep` | #3A0F0B | text on yellow, cart bar |
| | `--yel` | #FFC52E | primary action |
| | `--hot` / `--hot-ink` | #E4570E / #B14507 | heat accents (graphics) / accent text |
| Neutral | `--paper` `--surface` `--sunk` | #FBF7F0 `#FFFFFF` `#F4EEE4` | page, cards, wells |
| | `--line` `--field` | #E8DFD2 / #8C7B6E | hairlines / input borders (3:1) |
| | `--ink` `--ink-2` `--mut` | #241714 `#4F3F39` `#6A5851` | text (16.3 / 9.4 / 6.3 : 1 on paper) |
| Status | `--ok` `--warn` `--err` | #14703A `#9A4A00` `#B3261E` | each with a tinted `-bg` and dark `-ink` pair |

All text pairs are at least 4.5:1; input borders and the toggle track at least 3:1.

**Type** (Baloo 2 local, system UI body): display 34/800 (hero amount), title 22/800, section 16/800,
body 16/1.45 (16px also stops iOS zoom on inputs), secondary 14, caption 12 (minimum size anywhere).
**Space** 4-pt scale: 4 8 12 16 24 32. **Radius** 10 / 14 / 20 / pill. **Targets** 44 min, 48 default, 52 primary.
**Motion** 120 / 200 / 280 ms, `cubic-bezier(.2,.8,.2,1)`.

## Components (class contract is fixed by the JS; only CSS changes in a reset)
Buttons `.btn.pri|sec|dan|dark|wa` (52px; `.sm` 44px; `.big` 56px). Chips `.chip(.on)` pill 44px.
Segmented `.seg`. Cards `.li .card-s .set-card .kpi .mi`. Product tile `.card.pc` (4:3 photo, price,
yellow add button; in-cart tile gets a 2px brand ring and a stepper). Status `.badge .tag .bdg`.
Sheet `.sheet` (bottom on phone, centred dialog >= 900px). Cart bar `.cartbar` floats above the nav.

## Anti-patterns for this product
Emoji as icons; color-only status (always pair with text or an icon); text under 12px; gray-on-gray;
shadows on in-flow cards; more than one yellow button per screen; placeholder-only labels.

## Not in this reset
Dark mode (meta color-scheme stays light; a shop counter is usually bright), layout restructuring that
would need JS changes, new features.
