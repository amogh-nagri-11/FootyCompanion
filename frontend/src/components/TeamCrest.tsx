import styles from './TeamCrest.module.css';

interface Props {
  team: string;
  size?: number;
}

/**
 * "Arsenal" -> "ARS", "Manchester United" -> "MU", "Real Sociedad" -> "RS".
 * Short words like "de"/"of" are dropped so "Athletic Club de Bilbao" reads
 * as "ACB" rather than "ACD".
 */
function monogram(team: string): string {
  const words = team
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));

  if (words.length === 0) return team.slice(0, 2).toUpperCase() || '?';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Stable hue per club. Real crests need a licensed asset pipeline; a
 * deterministic colour at least gives every team a consistent identity that
 * the eye can track down a list of fixtures.
 */
function hue(team: string): number {
  let h = 0;
  for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) % 360;
  return h;
}

export function TeamCrest({ team, size = 30 }: Props) {
  const h = hue(team);
  const text = monogram(team);

  return (
    <span
      className={styles.crest}
      style={{
        width: size,
        height: size,
        // Mid-lightness fill with white text stays legible in either theme,
        // so the crest needs no dark-mode variant of its own.
        background: `linear-gradient(145deg, hsl(${h} 52% 48%), hsl(${(h + 24) % 360} 54% 38%))`,
        fontSize: Math.max(9, Math.round(size * (text.length > 2 ? 0.31 : 0.38))),
      }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}
