---
name: Precedent
description: Incident memory with warm charcoal surfaces, orange evidence paths, and pixel icons.
colors:
  ground: "#0a0a0a"
  paper: "#131211"
  surface-raised: "#1c1815"
  ink: "#faf7f2"
  quiet: "#b5a99e"
  border: "#3a3029"
  hairline: "#2a231e"
  accent: "#ff6a1a"
  accent-hover: "#ff9b64"
  accent-text: "#ffa06f"
  accent-soft: "#2a190f"
  action-ink: "#1a0d07"
  field: "#100e0c"
  field-border: "#49362b"
  map-ground: "#0d0c0b"
  map-selection: "#2a1d16"
  map-proximity: "#d7bca9"
  method-fill: "#1a1511"
  featured-evidence: "#27180f"
  featured-border: "#6d412b"
  featured-muted: "#ddbaa4"
  featured-focus: "#ffc2a0"
typography:
  hero:
    fontFamily: '"Bricolage Grotesque Variable", "Segoe UI", sans-serif'
    fontSize: "clamp(4.1rem, 7.1vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.91
    letterSpacing: "-.039em"
  analysis-title:
    fontFamily: '"Bricolage Grotesque Variable", "Segoe UI", sans-serif'
    fontSize: "clamp(2rem, 4vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-.018em"
  featured-title:
    fontFamily: '"Bricolage Grotesque Variable", "Segoe UI", sans-serif'
    fontSize: "clamp(1.65rem, 2.95vw, 2.45rem)"
    fontWeight: 650
    lineHeight: 1.06
    letterSpacing: "-.025em"
  body:
    fontFamily: '"Bricolage Grotesque Variable", "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  action:
    fontFamily: '"Bricolage Grotesque Variable", "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 670
  identifier:
    fontFamily: '"IBM Plex Mono", monospace'
    fontSize: "11px"
    fontWeight: 700
rounded:
  control: "2px"
  result: "4px"
  panel: "5px"
  evidence: "7px"
  map: "10px"
spacing:
  inset-8: "8px"
  inset-12: "12px"
  inset-13: "13px"
  inset-16: "16px"
  inset-21: "21px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.action-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  hero-action:
    backgroundColor: "{colors.accent}"
    textColor: "#170e09"
    rounded: "{rounded.panel}"
    padding: "9px 15px"
  alert-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  nav-item:
    textColor: "{colors.quiet}"
    padding: "2px 3px 0"
  nav-item-active:
    textColor: "{colors.ink}"
  work-panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  evidence-method:
    backgroundColor: "{colors.method-fill}"
    textColor: "{colors.quiet}"
    padding: "3px"
  evidence-method-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  featured-evidence:
    backgroundColor: "{colors.featured-evidence}"
    textColor: "{colors.ink}"
    typography: "{typography.featured-title}"
    rounded: "{rounded.evidence}"
    padding: "clamp(16px, 2.4vw, 27px)"
  incident-map:
    backgroundColor: "{colors.map-ground}"
    textColor: "{colors.quiet}"
    rounded: "{rounded.map}"
---

# Design System: Precedent

## Overview

**Creative North Star: "Find the fix in the noise."**

The homepage opens on the gateway 503 alert. Lookalikes flash amber crosses. An orange path links the gateway match to the separately worded registry incident, with source IDs and the relationship type shown under the two endpoint cards. Scroll to regroup the same stars by root cause. The repository mirror replay then shows how a recorded resolution adds a link and changes the next search.

The analysis workspace shows both top-five rankings and a three-node evidence path. The memory graph lets responders scrub the recorded history or follow an alert through its text matches, precedents, and fixes. The report distinguishes hosted proof, measured GitLab baselines, and synthetic replay.

**Key Characteristics:**

- Near-black surfaces with warm white type and orange actions.
- Bricolage Grotesque for reading and IBM Plex Mono for labels and identifiers.
- Streamline Pixel Mono Free icons with functional text.
- A scroll-driven constellation, open evidence comparisons, and a focused console evidence pane.

## Colors

### Primary

- **Orange** marks primary actions, keyboard focus, active navigation, and confirmed relationships. Pair the filled action color with dark type.
- **Soft orange** marks inline links and relationship text. The featured precedent uses a warm brown surface with a fine border.

### Neutral

- **Near-black and charcoal** separate the page, work surfaces, and hover states. Use warm white for titles and controls, and muted warm grey for supporting text.
- **Quiet rules** divide page regions and evidence. The constellation keeps its ambient dots and paths lower in contrast than the active projection.

**The Relationship Rule.** Pair the orange path with a relationship label, source identifiers, and a caption or explanation.

## Typography

Bricolage Grotesque Variable carries headlines, body copy, and controls. The opening homepage headline is tightly tracked with a 0.9 line height. The analysis title and featured incident follow a quieter scale. IBM Plex Mono labels the map, incident identifiers, relationship types, and keyboard shortcuts. Use tabular numerals for report values and similarity scores.

## Layout

The homepage shell is capped at 1320px. Desktop copy alternates sides over a sticky full-viewport field. At 950px the gutters narrow. Below 780px, text sits above the particles and the example and project sections stack. At 370px and below, the example outcomes use one column.

The workspace header and main content share a 1234px inner measure on wide screens. The alert editor and its follow-up occupy the left column. The evidence pane to the right includes two side-by-side ranking lists. The memory graph canvas spans the page width. At 760px and below, order the editor, evidence, and follow-up vertically. At 420px and below, the relationship action may take its own line. At 400px and below, navigation keeps the text labels and omits its icons. Report tables scroll inside their panel.

## Elevation & Depth

Use thin borders and subtle surface changes to group content. The field uses subtle atmospheric depth and bright points to separate the active relationship from the ambient particles. Dialogs use a translucent near-black backdrop.

## Shapes

Homepage actions have square corners. Workspace buttons and fields use small-radius corners. The alert editor and featured incident use 7px corners. The relationship is a line with labeled endpoints. In the graph, node shape and icon distinguish runbooks from incident-like nodes.

## Components

### Brand and navigation

Use the connected-node mark with the Precedent wordmark. Workspace navigation uses compact Streamline Pixel Mono Free icons alongside labels. The current route uses an orange underline and icon. The homepage uses text navigation and a distinct console action.

### Buttons and fields

Use filled orange for primary actions, dark outlined buttons for secondary actions, and underlined text for related links. Keep the 2px keyboard focus outline and a 3px offset. Use a lighter orange focus color inside featured evidence. Alert fields use dark fill, a visible border, persistent labels, and an independently resizable text area.

### Incident field

Three.js renders one point per bundled synthetic replay incident. Opening groups come from symptom similarity to the recorded sample alerts. Scroll moves those same points into groups labeled by recorded root cause. Configuration is lilac, capacity is amber, and dependency is teal. Confirmed fix paths use orange. The alert and the moving pulse are markers. Keep node labels at 12px IBM Plex Mono. Reduced motion shows settled paths without the intro flash sequence or traveling pulse. The before-and-after meter shows recorded edge totals and labels the one confirmed outcome.

### Incident evidence

Show Vector top 5 and Precedent top 5 side by side. Keep actual rank order and show rank movement with arrows and source IDs. Render the text similarity bar only for available scores. A confirmed-fix badge requires a recorded SAME_FIX_AS path. Show the alert, match, and precedent as three nodes on the featured evidence card, with the reason and inspect action in the same block. Recorded views use the neutral synthetic provenance pill.

### Graph and report

Center the radial graph on the selected incident. On narrow layouts use compact IDs and reveal the full title through node selection. Use thin neutral auto-extracted links, dashed declared links, and thick orange learned links with a traveling marker. Show reasons on hover or selection. A batch only shows edges whose endpoints and confirmation are already present. Path tree reads left to right from alert to text matches, precedents, and fixes.

Lead the replay with the four pre-registered proof statuses and the audited GitLab bars. Unknown hosted results use outlined bars without a value. The synthetic curve shows paired deltas versus vector and a paired 95% confidence band. Keep the exact values and ablation table below.

## Do's and Don'ts

- **Do** pair orange relationship paths with labels and source identifiers.
- **Do** keep Streamline Pixel icons alongside action text where space allows.
- **Do** keep the vector baseline reachable from the evidence pane at all widths.
- **Do** distinguish illustrative layout from the recorded relationship.
- **Don't** apply the constellation halo to general panels or actions.
