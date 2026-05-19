# Visual Review

A zero-dependency, drop-in annotation overlay for any webpage. Pin comments, edit text inline, draw on the page, reorder sections, add new elements — then export everything as a markdown blob you can paste into ChatGPT, Claude, Cursor, or hand to a developer.

Think Pastel meets Frame.io, but local, free, and designed so an AI coding assistant can apply the changes directly.

```
┌────────────────────────────────────────────────────┐
│   [Your name] · 📌 ✏️ ✍️ ↕ ➕  ·  📋(3) · 📤 Send   │
└────────────────────────────────────────────────────┘
```

## Why

Reviewing landing pages, designs, or marketing sites usually means screenshots with arrows, long Slack messages, or paid tools. Visual Review keeps the loop tight:

1. Click around on the live page
2. Pin comments, edit copy, draw, drag, delete, add
3. Hit **Send** — a structured markdown export goes to your clipboard
4. Paste it into your AI coding assistant — every annotation includes a CSS selector so the change can be applied to the exact element

No accounts. No cloud. Annotations live in `localStorage` keyed by page path.

## Quick start

Two files: `review.js` and `review.css`. Include them on any page, gated behind `?review=1` so they only load when you want to review:

```html
<script>
  if (new URLSearchParams(location.search).get('review') === '1') {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/gh/donsolutions/visual-review@main/review.css';
    document.head.appendChild(link);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/donsolutions/visual-review@main/review.js';
    s.defer = true;
    document.body.appendChild(s);
  }
</script>
```

Then visit `yourpage.com/?review=1` and the toolbar appears bottom-right.

To force-enable without a query param (e.g. inside a staging environment):

```html
<script>window.__REVIEW_MODE__ = true;</script>
<link rel="stylesheet" href="/path/to/review.css">
<script src="/path/to/review.js" defer></script>
```

## Modes

| Button | What it does |
|---|---|
| 📌 **Pin** | Click any element to drop a numbered pin with a comment popover. |
| ✏️ **Edit** | Click any text element to make it contenteditable. On blur, the before/after diff is recorded. |
| ✍️ **Draw** | Freehand pen over the page with 5 colors. Strokes anchor to the section they're drawn in, so they reposition correctly on scroll, resize, and reload. |
| ↕ **Layout** | Drag sections to reorder. Click × to mark a section for deletion. Hover between sections for "+ Add space here" (sm/md/lg). |
| ➕ **Add** | Opens a palette of element types (headline, paragraph, button, bullet list, image, video, testimonial, divider, new section). Drag onto the page to insert; drop targets are detected at the cursor, so you can place elements between any two sibling elements inside any container. |
| 📋 **Panel** | Side panel with all annotations. Click any card to scroll to the element. Resolve, reopen, or delete individual annotations. **Clear all** wipes everything for the current page. |
| 📤 **Send** | Generates a markdown + JSON export ready to paste into an AI assistant. |

## Export format

Each annotation in the export records the element selector, text preview, and what change is requested. Example:

````markdown
# Page Review

**Page:** https://example.com/landing?review=1
**Reviewer:** Matt
**Date:** 2026-05-19T20:30:00.000Z
**Annotations:** 3

---

### 1. Edit
**Selector:** `section.hero > div.hero-inner > h1`
**Element text:** "A clean, generic landing page"

**Before:**
```
A clean, generic landing page
```
**After:**
```
Tools for clean, fast feedback loops
```

---

### 2. Add element
**Type:** button
**Parent:** `section.hero > div.hero-inner`
**Insert after:** `p`
**Content:**
```html
<a href="#" style="display:inline-block;padding:14px 28px;background:#F59E0B;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Start free trial</a>
```

---

### 3. Move
**Selector:** `section.features`
**New position:** directly after `section.testimonial`
From index 1 → to index 2

<details><summary>Raw JSON</summary>

```json
{ ... full structured payload ... }
```
</details>
````

The selectors are unique per page, the diff for text edits is exact, and the structure is consistent — so an AI assistant can apply every change without needing screenshots.

## Annotation types

| Type | Fields |
|---|---|
| `comment` | selector, textPreview, anchor (ax, ay), comment |
| `edit` | selector, before, after |
| `draw` | selector (anchoring section), color, strokeWidth, points (normalized to anchor bbox) |
| `move` | selector, fromIndex, toIndex, afterSelector, beforeSelector |
| `delete` | selector |
| `space` | selector, position (before/after), size (sm/md/lg) |
| `add` | elementType, parentSelector, afterSelector, beforeSelector, html |

## Demo

Open `example/index.html` in a browser, then add `?review=1` to the URL.

```bash
git clone https://github.com/donsolutions/visual-review.git
cd visual-review
open example/index.html
# then in the address bar: file:///.../example/index.html?review=1
```

For drag-and-drop to work reliably, serve over HTTP rather than `file://`:

```bash
python3 -m http.server 8000
# visit http://localhost:8000/example/?review=1
```

## How it works

- **Pin / Edit** — Generates a stable CSS selector path (uses `#id` when available, falls back to nth-of-type lineage). Pin position is stored as normalized `(ax, ay)` inside the element's bounding box, so it reproduces on scroll and resize.
- **Draw** — One document-sized SVG overlay. Each stroke anchors to the deepest section under its centroid, with points stored as `(x, y)` normalized to that section's bounding box. On render, the stroke reprojects against the section's current position.
- **Layout** — Native HTML5 drag-and-drop on top-level `<section>` elements, header, footer, and direct children of `<main>`. Move operations physically reorder the DOM and record the new position. Deletes are visual flags only — nothing is actually removed.
- **Add** — Uses `document.elementsFromPoint` to find the cursor's nearest block-level container, walking up past inline carriers (`p`, `h1-h6`, `a`, `span`, etc.). This means new elements drop into the same column/wrapper as the surrounding content, inheriting brand styling naturally.
- **Persistence** — `localStorage` keyed by `pathname`. State is replayed on reload: strokes redraw, moved sections stay in their new order, deletes re-fade, added elements re-insert.

## Limitations

- Single-page only. Each path has its own annotation state.
- Doesn't sync across devices or users. This is intentional — it's a local tool, not a collaboration platform.
- Inserted elements use generic placeholder styling. The export records the raw HTML; restyle as needed when applying to your codebase.
- Move/delete operate on top-level sections, not nested elements. For nested layout changes, use a Pin comment.

## License

MIT. Use it, fork it, ship it.
