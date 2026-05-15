import type { CSSProperties } from 'react';

export function photoStageStyle(
  width?: number,
  height?: number,
  maxViewportHeight = 68
): CSSProperties {
  const safeWidth = width && width > 0 ? width : 4;
  const safeHeight = height && height > 0 ? height : 3;
  const aspect = safeWidth / safeHeight;

  return {
    aspectRatio: `${safeWidth} / ${safeHeight}`,
    width: `min(100%, ${(aspect * maxViewportHeight).toFixed(3)}vh)`,
  };
}
