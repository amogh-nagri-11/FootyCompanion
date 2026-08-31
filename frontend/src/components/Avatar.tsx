import { useState } from 'react';
import styles from './Avatar.module.css';

interface Props {
  name: string;
  url?: string | null;
  size?: number;
}

/** Up to two initials from a name, e.g. "Amogh Bhat" -> "AB", "amogh" -> "A". */
function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, url, size = 64 }: Props) {
  // A URL that fails to load falls back to initials rather than a broken image.
  const [failed, setFailed] = useState(false);
  const showImage = url && !failed;

  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          className={styles.image}
          src={url}
          alt=""
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
