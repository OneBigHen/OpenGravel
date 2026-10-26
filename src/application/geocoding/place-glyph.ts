/** A search category's familiar map symbol, independent of renderer fonts. */
export type PlaceGlyph = "gas" | "food" | "coffee" | "lodging" | "moto" | "place";

export function searchPinGlyph(name: string, context: string, category: string | null): PlaceGlyph {
  if (category === "gas" || category === "food" || category === "coffee" || category === "lodging" || category === "moto") return category;
  const description = `${name} ${context}`;
  if (/\b(gas|fuel|petrol)\b/i.test(description)) return "gas";
  if (/\b(coffee|cafe|café)\b/i.test(description)) return "coffee";
  if (/\b(hotel|motel|inn|lodging|hostel)\b/i.test(description)) return "lodging";
  if (/\b(motorcycle|moto|mechanic|repair)\b/i.test(description)) return "moto";
  if (/\b(food|restaurant|diner|pizza|grill)\b/i.test(description)) return "food";
  return "place";
}
