/**
 * A minimal XML writer for CII documents.
 *
 * Built as a tree rather than concatenated strings for one reason: the CII schema defines its
 * content models as `xsd:sequence`, so element order is not cosmetic - a document with
 * `ram:BasisAmount` before `ram:TypeCode` is schema-invalid and rejected outright, while looking
 * entirely correct to a human reader. Expressing the document as nested calls makes the required
 * order the visible structure of the code, and makes escaping impossible to forget.
 *
 * Two constructors rather than one overloaded one: CII elements are either containers or text
 * leaves, never both, and keeping them distinct means a misplaced argument is a type error instead
 * of a silently empty element.
 */

export interface XmlNode {
  readonly name: string;
  readonly attrs?: Readonly<Record<string, string | null | undefined>>;
  readonly text?: string;
  readonly children?: readonly (XmlNode | null | undefined)[];
}

/** A container element. `null` children are dropped, so optional fields read as conditionals. */
export function el(
  name: string,
  children: readonly (XmlNode | null | undefined)[],
  attrs?: Readonly<Record<string, string | null | undefined>>,
): XmlNode {
  return { name, children, attrs };
}

/** A text leaf, optionally carrying attributes (`<ram:BilledQuantity unitCode="C62">6</...>`). */
export function leaf(
  name: string,
  value: string,
  attrs?: Readonly<Record<string, string | null | undefined>>,
): XmlNode {
  return { name, text: value, attrs };
}

/**
 * Escapes text content.
 *
 * `>` is escaped along with `<` and `&` even though a bare `>` is legal in content: it is legal
 * only outside a `]]>` sequence, and a company name is user input.
 */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

/**
 * Strips characters XML 1.0 cannot represent at all.
 *
 * Control characters reach us from copy-pasted spreadsheet cells and from CSV imports. There is no
 * escape for them in XML 1.0 - not even a numeric character reference - so a single stray `\x01` in
 * a product name makes the whole document unparseable for every downstream reader.
 */
export function sanitiseText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function renderAttrs(attrs: XmlNode['attrs']): string {
  return Object.entries(attrs ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeAttr(sanitiseText(value))}"`)
    .join('');
}

function renderNode(node: XmlNode, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const attrs = renderAttrs(node.attrs);

  if (node.text !== undefined) {
    out.push(
      `${indent}<${node.name}${attrs}>${escapeText(sanitiseText(node.text))}</${node.name}>`,
    );
    return;
  }

  const children = (node.children ?? []).filter((child): child is XmlNode => Boolean(child));
  if (children.length === 0) {
    out.push(`${indent}<${node.name}${attrs}/>`);
    return;
  }

  out.push(`${indent}<${node.name}${attrs}>`);
  for (const child of children) renderNode(child, depth + 1, out);
  out.push(`${indent}</${node.name}>`);
}

/** Renders a document, prefixed with the XML declaration. UTF-8 throughout. */
export function renderXml(root: XmlNode): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  renderNode(root, 0, out);
  return `${out.join('\n')}\n`;
}
