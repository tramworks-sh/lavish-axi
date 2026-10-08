import assert from "node:assert/strict";
import test from "node:test";

import {
  phoneBlockTarget,
  phoneNoteHeading,
  phoneRevealDelta,
  phoneSectionFor,
  phoneSectionTarget,
  phoneSheetPlacement,
  phoneTargetName,
} from "../src/phone-review.js";
import { createSdkJs } from "../src/server.js";

// A small element tree: enough of the DOM for the phone helpers, which only walk parents, read
// tags and text, and compare document order.
function el(tag, { display = "", text = "" } = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    nodeType: 1,
    parentElement: null,
    children: [],
    textContent: text,
    display,
    closest(selectorList) {
      const tags = selectorList.split(",").map((part) => part.trim());
      let current = node;
      while (current) {
        if (tags.includes(current.tagName.toLowerCase())) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === node) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelector(selectorList) {
      return all(node).find((child) => child !== node && matches(child, selectorList)) || null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

function all(root) {
  return [root, ...root.children.flatMap((child) => all(child))];
}

function matches(node, selectorList) {
  return selectorList
    .split(",")
    .map((part) => part.trim())
    .includes(node.tagName.toLowerCase());
}

// Document order comes from a pre-order walk, as in a real DOM.
function documentOf(body) {
  const order = all(body);
  for (const node of order) {
    node.compareDocumentPosition = (other) => (order.indexOf(other) > order.indexOf(node) ? 4 : 2);
  }
  return { querySelectorAll: (selectorList) => order.filter((node) => matches(node, selectorList)) };
}

const displayOf = (node) => node.display;

test("phoneBlockTarget climbs from inline spans to the block a finger tapped", () => {
  const bold = el("strong", { display: "inline" });
  const link = el("a", { display: "inline" }, [bold]);
  const paragraph = el("p", { display: "block" }, [link]);
  el("body", { display: "block" }, [paragraph]);
  assert.equal(phoneBlockTarget(bold, displayOf), paragraph);
});

test("phoneBlockTarget lands on the table cell around a badge", () => {
  const badge = el("span", { display: "inline-block" });
  const cell = el("td", { display: "table-cell" }, [badge]);
  el("tr", { display: "table-row" }, [cell]);
  assert.equal(phoneBlockTarget(badge, displayOf), cell);
});

test("phoneBlockTarget stops at a styled block that is not a named block tag", () => {
  const label = el("span", { display: "inline" });
  const card = el("span", { display: "flex" }, [label]);
  el("div", { display: "block" }, [card]);
  assert.equal(phoneBlockTarget(label, displayOf), card);
});

test("phoneBlockTarget keeps a block-level tap as it is and never climbs to body", () => {
  const item = el("li", { display: "list-item" });
  el("ul", { display: "block" }, [item]);
  assert.equal(phoneBlockTarget(item, displayOf), item);
  const loose = el("span", { display: "inline" });
  el("body", { display: "block" }, [loose]);
  assert.equal(phoneBlockTarget(loose, displayOf), loose);
});

test("phoneTargetName and phoneNoteHeading speak in plain words", () => {
  assert.equal(phoneTargetName({ tag: "p" }), "paragraph");
  assert.equal(phoneTargetName({ tag: "li" }), "list item");
  assert.equal(phoneTargetName({ tag: "h3" }), "heading");
  assert.equal(phoneTargetName({ tag: "text" }), "selected text");
  assert.equal(phoneTargetName({ tag: "span" }), "this part");
  assert.equal(phoneNoteHeading({ tag: "p" }), "Note on paragraph");
  assert.equal(
    phoneNoteHeading({ tag: "td", target: { type: "table-cell", rowLabel: "Build", columnLabel: "Owner" } }),
    "Note on table cell: Build, Owner",
  );
  assert.equal(phoneNoteHeading({ tag: "td", target: { type: "table-cell" } }), "Note on table cell");
  assert.equal(
    phoneNoteHeading({ tag: "h2", target: { type: "section", heading: "Risks" } }),
    "Note on section: Risks",
  );
});

test("phoneSectionFor picks the nearest heading at or before the tapped block", () => {
  const title = el("h1", { text: "Plan" });
  const intro = el("p", { text: "Intro" });
  const risks = el("h2", { text: "Risks" });
  const first = el("p", { text: "First risk" });
  const second = el("p", { text: "Second risk" });
  const body = el("body", {}, [title, intro, risks, first, second]);
  const doc = documentOf(body);
  assert.deepEqual(phoneSectionFor(second, doc), { element: risks, heading: "Risks", scope: "heading" });
  assert.deepEqual(phoneSectionFor(intro, doc), { element: title, heading: "Plan", scope: "heading" });
  assert.deepEqual(phoneSectionFor(risks, doc), { element: risks, heading: "Risks", scope: "heading" });
});

test("phoneSectionFor prefers an explicit section element and returns null with no heading", () => {
  const heading = el("h2", { text: "Step 2" });
  const inner = el("p", { text: "Card, Apple Pay" });
  const section = el("section", {}, [heading, inner]);
  const body = el("body", {}, [section]);
  assert.deepEqual(phoneSectionFor(inner, documentOf(body)), { element: section, heading: "Step 2", scope: "element" });

  const lonely = el("p", { text: "No headings here" });
  const flat = el("body", {}, [lonely]);
  assert.equal(phoneSectionFor(lonely, documentOf(flat)), null);
});

test("phoneSectionTarget has a fixed shape for the agent", () => {
  assert.deepEqual(phoneSectionTarget("body > h2:nth-of-type(2)", { heading: "Risks", scope: "heading" }), {
    type: "section",
    selector: "body > h2:nth-of-type(2)",
    heading: "Risks",
    scope: "heading",
  });
  assert.equal(phoneSectionTarget("", { scope: "bogus" }).scope, "heading");
});

test("phoneSheetPlacement rests the sheet on the visible band's lower edge", () => {
  // No report yet: the sheet sits on the frame's bottom edge and may use the whole frame.
  assert.deepEqual(phoneSheetPlacement(600, { visibleTop: 0, visibleBottom: Infinity }), { bottom: 0, maxHeight: 600 });
  // Keyboard and dock cover the lower 330px of the frame.
  assert.deepEqual(phoneSheetPlacement(600, { visibleTop: 0, visibleBottom: 270 }), { bottom: 330, maxHeight: 270 });
  // The page panned up 40px: the band starts lower too.
  assert.deepEqual(phoneSheetPlacement(600, { visibleTop: 40, visibleBottom: 300 }), { bottom: 300, maxHeight: 260 });
  // A nonsense report falls back to the whole frame rather than a zero-height sheet.
  assert.deepEqual(phoneSheetPlacement(600, { visibleTop: 100, visibleBottom: 0 }), { bottom: 0, maxHeight: 500 });
});

test("phoneRevealDelta scrolls only as far as needed to show the target above the sheet", () => {
  assert.equal(phoneRevealDelta({ top: 50, bottom: 90 }, 0, 300), 0);
  assert.equal(phoneRevealDelta({ top: 400, bottom: 440 }, 0, 300), 152);
  assert.equal(phoneRevealDelta({ top: -80, bottom: -40 }, 0, 300), -92);
  // Taller than the strip: line up its top.
  assert.equal(phoneRevealDelta({ top: 100, bottom: 700 }, 0, 300), 88);
  assert.equal(phoneRevealDelta(null, 0, 300), 0);
});

test("the served SDK bundle declares every phone helper the annotation path calls", () => {
  const source = createSdkJs("phonekey0000000a");
  for (const name of [
    "phoneBlockTarget",
    "phoneNoteHeading",
    "phoneRevealDelta",
    "phoneSectionFor",
    "phoneSectionTarget",
    "phoneSheetPlacement",
    "phoneTargetName",
  ]) {
    assert.match(source, new RegExp(`const ${name}=`), name);
  }
});
