import type { ImportLimits } from "@/application/import/limits";
import { ImportSecurityError } from "./types";

export interface XmlElement {
  readonly name: string;
  readonly localName: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

function localName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function isNameStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_:]/.test(character);
}

function isNameCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_.:-]/.test(character);
}

function decodeEntities(value: string): string {
  return value.replaceAll(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") || body.startsWith("#X")
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedXmlText(value: string, limits: ImportLimits, label: string): string {
  const decoded = decodeEntities(value);
  if (byteLength(decoded) > limits.MAX_STRING_BYTES) {
    throw new ImportSecurityError(`${label} exceeds the ${limits.MAX_STRING_BYTES}-byte XML string limit.`);
  }
  return decoded;
}

function appendXmlText(element: MutableElement, value: string, limits: ImportLimits): void {
  const decoded = boundedXmlText(value, limits, "XML text");
  if (byteLength(element.text) + byteLength(decoded) > limits.MAX_STRING_BYTES) {
    throw new ImportSecurityError(`XML text exceeds the ${limits.MAX_STRING_BYTES}-byte XML string limit.`);
  }
  element.text += decoded;
}

function findTagEnd(xml: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

interface MutableElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlElement[];
  text: string;
}

function parseOpeningTag(
  content: string,
  limits: ImportLimits,
): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
  let cursor = 0;
  const skipSpace = () => {
    while (cursor < content.length && /\s/.test(content[cursor] ?? "")) cursor += 1;
  };
  const readName = (): string => {
    if (!isNameStart(content[cursor])) throw new SyntaxError("Malformed XML tag name.");
    const start = cursor;
    cursor += 1;
    while (isNameCharacter(content[cursor])) cursor += 1;
    return content.slice(start, cursor);
  };

  skipSpace();
  const name = readName();
  const attributes = Object.create(null) as Record<string, string>;
  let selfClosing = false;
  while (cursor < content.length) {
    skipSpace();
    if (cursor >= content.length) break;
    if (content[cursor] === "/") {
      cursor += 1;
      skipSpace();
      if (cursor !== content.length) throw new SyntaxError("Malformed XML closing marker.");
      selfClosing = true;
      break;
    }
    const attributeName = readName();
    if (Object.hasOwn(attributes, attributeName)) {
      throw new SyntaxError(`Duplicate XML attribute ${attributeName}.`);
    }
    skipSpace();
    if (content[cursor] !== "=") throw new SyntaxError("Malformed XML attribute.");
    cursor += 1;
    skipSpace();
    const quote = content[cursor];
    if (quote !== '"' && quote !== "'") throw new SyntaxError("XML attributes must be quoted.");
    cursor += 1;
    const valueStart = cursor;
    while (cursor < content.length && content[cursor] !== quote) cursor += 1;
    if (cursor >= content.length) throw new SyntaxError("Unterminated XML attribute.");
    const rawValue = content.slice(valueStart, cursor);
    const value = boundedXmlText(rawValue, limits, `XML attribute ${attributeName}`);
    if (byteLength(value) > limits.MAX_ATTRIBUTE_BYTES) {
      throw new ImportSecurityError(`XML attribute ${attributeName} exceeds its size limit.`);
    }
    attributes[attributeName] = value;
    cursor += 1;
  }
  return { name, attributes, selfClosing };
}

function asElement(element: MutableElement): XmlElement {
  return {
    name: element.name,
    localName: localName(element.name),
    attributes: element.attributes,
    children: element.children,
    text: element.text,
  };
}

/** A small, namespace-tolerant XML reader with no external entity processing. */
export function parseXmlDocument(xml: string, limits: ImportLimits): XmlElement {
  if (xml.length === 0) throw new SyntaxError("The XML document is empty.");
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new ImportSecurityError("DOCTYPE and external XML entities are not supported.");
  }
  const stack: MutableElement[] = [];
  let root: XmlElement | null = null;
  let cursor = 0;
  while (cursor < xml.length) {
    const opening = xml.indexOf("<", cursor);
    if (opening < 0) {
      if (stack.length > 0) appendXmlText(stack.at(-1)!, xml.slice(cursor), limits);
      else if (xml.slice(cursor).trim() !== "") throw new SyntaxError("Text appears outside the XML root.");
      break;
    }
    if (opening > cursor) {
      const text = xml.slice(cursor, opening);
      if (stack.length > 0) appendXmlText(stack.at(-1)!, text, limits);
      else if (text.trim() !== "") throw new SyntaxError("Text appears outside the XML root.");
    }
    if (xml.startsWith("<!--", opening)) {
      const end = xml.indexOf("-->", opening + 4);
      if (end < 0) throw new SyntaxError("Unterminated XML comment.");
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const end = xml.indexOf("]]>", opening + 9);
      if (end < 0) throw new SyntaxError("Unterminated CDATA section.");
      if (stack.length === 0) throw new SyntaxError("CDATA appears outside the XML root.");
      appendXmlText(stack.at(-1)!, xml.slice(opening + 9, end), limits);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const end = xml.indexOf("?>", opening + 2);
      if (end < 0) throw new SyntaxError("Unterminated XML declaration.");
      cursor = end + 2;
      continue;
    }
    const end = findTagEnd(xml, opening + 1);
    if (end < 0) throw new SyntaxError("Unterminated XML tag.");
    const content = xml.slice(opening + 1, end);
    if (content.startsWith("/")) {
      const closingName = content.slice(1).trim();
      if (!/^[-A-Za-z_:][-A-Za-z0-9_.:]*$/.test(closingName)) throw new SyntaxError("Malformed XML closing tag.");
      const current = stack.pop();
      if (current === undefined || current.name !== closingName) throw new SyntaxError("Mismatched XML closing tag.");
      const completed = asElement(current);
      if (stack.length > 0) stack.at(-1)!.children.push(completed);
      else if (root !== null) throw new SyntaxError("XML contains multiple roots.");
      else root = completed;
    } else {
      if (content.startsWith("!")) throw new ImportSecurityError("Unsupported XML declaration.");
      const tag = parseOpeningTag(content, limits);
      if (stack.length + 1 > limits.MAX_XML_DEPTH) {
        throw new ImportSecurityError(`XML nesting exceeds the ${limits.MAX_XML_DEPTH}-level limit.`);
      }
      const element: MutableElement = { name: tag.name, attributes: tag.attributes, children: [], text: "" };
      if (tag.selfClosing) {
        const completed = asElement(element);
        if (stack.length > 0) stack.at(-1)!.children.push(completed);
        else if (root !== null) throw new SyntaxError("XML contains multiple roots.");
        else root = completed;
      } else {
        stack.push(element);
      }
    }
    cursor = end + 1;
  }
  if (stack.length > 0 || root === null) throw new SyntaxError("The XML document is malformed.");
  return root;
}

export function descendants(element: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (const child of element.children) {
    if (child.localName === name) result.push(child);
    result.push(...descendants(child, name));
  }
  return result;
}

export function directChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.localName === name);
}

export function childText(element: XmlElement, name: string): string | null {
  const child = directChild(element, name);
  return child === undefined ? null : child.text.trim();
}

export function textBytes(value: string): number {
  return byteLength(value);
}
