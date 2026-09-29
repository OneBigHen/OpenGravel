import { longTripFixturePreparation } from "@/application/long-trip/fixture";
import { RoutePreparationSection } from "./RoutePreparationSection";

export function LongTripFixturePage({ long }: { readonly long: boolean }) {
  const title = long ? "Long-trip fixture" : "Short-trip fixture";
  return (
    <main id="main" className="og-route-detail" data-testid={long ? "long-trip-fixture" : "short-trip-fixture"}>
      <header className="og-route-detail__header">
        <p className="og-eyebrow">Preparation test fixture</p>
        <h1>{title}</h1>
        <p className="og-route-detail__provenance">Synthetic fixture — not a world claim.</p>
      </header>
      <RoutePreparationSection preparation={longTripFixturePreparation(long)} />
    </main>
  );
}
