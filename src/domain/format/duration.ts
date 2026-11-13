/**
 * The one duration formatter for the whole app: `1 h 52 min`, `45 min`, `2 h`.
 * Minutes are always spelled `min`, never a bare `m` (which reads as metres next
 * to an elevation or a distance). Every surface that prints a ride time goes
 * through this, so a pill, a sheet and a card can never disagree.
 */
export function formatWholeMinutes(totalMinutes: number): string {
  const whole = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
