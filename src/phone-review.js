// Phone review: how a finger-driven review decides what a note is about, what to call it, and
// where the note sheet sits. Only a coarse pointer on a phone-width frame reaches these helpers,
// so desktop annotation never changes.
//
// Every helper here is serialized wholesale into the artifact SDK bundle by `createSdkJs`, so
// each one may reference only its own arguments, browser globals, or its sibling exports.

export function phoneTagName(element) {
  return String(element?.tagName || element?.nodeName || "").toLowerCase();
}

export function phoneText(element) {
  return String(element?.innerText || element?.textContent || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

// Elements a phone note attaches to as they are. Everything else climbs to the block it sits in.
export function isPhoneBlockTag(tag) {
  return [
    "p",
    "li",
    "td",
    "th",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "figure",
    "figcaption",
    "caption",
    "img",
    "picture",
    "video",
    "canvas",
  ].includes(String(tag || ""));
}

// A fingertip covers several inline spans at once, so a tap names the block it landed in rather
// than the bold word, link, or badge under the finger. Inline wrappers climb; the named block
// tags and any element the page lays out as a block stop the climb. `displayOf` reads the
// computed display so a styled <span class="card"> that is really a block still stops it.
export function phoneBlockTarget(element, displayOf) {
  let node = element;
  while (node && node.nodeType === 1) {
    const tag = phoneTagName(node);
    if (tag === "body" || tag === "html") break;
    if (isPhoneBlockTag(tag)) return node;
    const display = String((displayOf && displayOf(node)) || "");
    if (display && !display.startsWith("inline") && display !== "contents") return node;
    node = node.parentElement;
  }
  return element;
}

// The plain name a reviewer sees for what a note is attached to.
export function phoneTargetName(context) {
  const tag = String(context?.tag || "");
  const type = String(context?.target?.type || "");
  if (type === "section") return "section";
  if (tag === "text") return "selected text";
  if (tag === "mermaid-node") return "diagram node";
  if (type === "table-cell" || tag === "td" || tag === "th") return "table cell";
  if (/^h[1-6]$/.test(tag)) return "heading";
  const names = {
    p: "paragraph",
    li: "list item",
    blockquote: "quote",
    pre: "code block",
    img: "image",
    picture: "image",
    figure: "figure",
    figcaption: "caption",
    caption: "table caption",
    dt: "term",
    dd: "definition",
    table: "table",
    ul: "list",
    ol: "list",
    video: "video",
    canvas: "drawing",
  };
  return names[tag] || "this part";
}

export function phoneNoteHeading(context) {
  const name = phoneTargetName(context);
  const target = context?.target || {};
  if (target.type === "section" && target.heading) return "Note on section: " + target.heading;
  const cell = [target.rowLabel, target.columnLabel]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  if (target.type === "table-cell" && cell) return "Note on table cell: " + cell;
  return "Note on " + name;
}

// The section a phone note can widen to: an explicit <section> or <article> wins, otherwise the
// nearest heading at or before the element in document order. `scope` tells the agent which.
export function phoneSectionFor(element, doc) {
  if (!element || element.nodeType !== 1) return null;
  const explicit = element.closest ? element.closest("section,article") : null;
  if (explicit) {
    const heading = explicit.querySelector ? explicit.querySelector("h1,h2,h3,h4,h5,h6") : null;
    return { element: explicit, heading: heading ? phoneText(heading) : "", scope: "element" };
  }
  let found = null;
  for (const heading of Array.from(doc?.querySelectorAll ? doc.querySelectorAll("h1,h2,h3,h4,h5,h6") : [])) {
    if (heading === element || (heading.contains && heading.contains(element))) {
      found = heading;
      break;
    }
    // Node.DOCUMENT_POSITION_FOLLOWING: the element comes after this heading.
    if (heading.compareDocumentPosition && heading.compareDocumentPosition(element) & 4) found = heading;
    else break;
  }
  return found ? { element: found, heading: phoneText(found), scope: "heading" } : null;
}

export function phoneSectionTarget(selector, section) {
  return {
    type: "section",
    selector: String(selector || ""),
    heading: String(section?.heading || ""),
    // "heading": the heading and everything after it up to the next heading of the same or a
    // higher level. "element": the whole <section> or <article> the selector names.
    scope: section?.scope === "element" ? "element" : "heading",
  };
}

// Where the phone note sheet sits inside the artifact frame: on the lower edge of the band the
// chrome reports as visible (above the keyboard and the conversation dock), never taller than it.
export function phoneSheetPlacement(frameHeight, viewport) {
  const height = Math.max(0, Number(frameHeight) || 0);
  const top = Math.min(Math.max(0, Number(viewport?.visibleTop) || 0), height);
  const reported = Number(viewport?.visibleBottom);
  const bottomEdge = Number.isFinite(reported) && reported > top ? Math.min(reported, height) : height;
  return { bottom: Math.round(height - bottomEdge), maxHeight: Math.round(Math.max(0, bottomEdge - top)) };
}

// How far to scroll so the annotated element shows in the strip between the visible top and the
// sheet. Zero when it already fits; an element taller than the strip lines up its top.
export function phoneRevealDelta(rect, visibleTop, sheetTop, margin = 12) {
  if (!rect) return 0;
  const top = (Number(visibleTop) || 0) + margin;
  const bottom = (Number(sheetTop) || 0) - margin;
  if (bottom <= top) return 0;
  if (rect.top >= top && rect.bottom <= bottom) return 0;
  if (rect.top < top || rect.bottom - rect.top > bottom - top) return Math.round(rect.top - top);
  return Math.round(rect.bottom - bottom);
}
