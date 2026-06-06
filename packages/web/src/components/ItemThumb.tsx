import { useEffect, useRef, useState } from 'react';
import { inferItemSemantic } from '@home-inventory/core';
import type { Item } from '@home-inventory/core';
import { PinIcon } from './PinIcon';

interface Props {
  item: Pick<Item, 'name' | 'tags' | 'aiEmoji' | 'image'>;
  className?: string;
  /** 当物品已有 image blob 时，是否使用 image 优先于语义图。默认 true。 */
  preferBlob?: boolean;
}

/**
 * 物品缩略图。
 *
 * - 若 item.image 存在且非空 → 显示图片
 * - 否则 → 用 emoji + 渐变背景，渲染漂亮的语义缩略图（纯 DOM，零成本）
 *
 * 该组件自带 onError 回退。
 */
export function ItemThumb({ item, className = '', preferBlob = true }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(96);

  useEffect(() => {
    setImgFailed(false);
    const blob = item.image;
    if (!preferBlob || !blob || !(blob instanceof Blob) || blob.size < 8) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.image, preferBlob]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (w > 0) setSize(w);
      }
    });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  const showImg = url && !imgFailed;

  if (showImg) {
    return (
      <img
        src={url!}
        alt={item.name}
        className={className}
        onError={() => setImgFailed(true)}
      />
    );
  }

  const guess = inferItemSemantic(item.name || '', item.tags || [], item.aiEmoji);
  const bgFrom = `hsl(${guess.hue}, 88%, 92%)`;
  const bgTo = `hsl(${(guess.hue + 28) % 360}, 80%, 80%)`;
  const labelColor = `hsl(${guess.hue}, 38%, 28%)`;
  const emojiSize = Math.round(size * 0.5);
  const labelSize = Math.max(10, Math.round(size * 0.12));
  const labelBottom = Math.max(4, Math.round(size * 0.05));

  return (
    <div
      ref={wrapRef}
      className={`semantic-thumb ${className}`}
      style={{
        background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label={item.name}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(at 28% 22%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 60%)',
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          fontSize: emojiSize,
          lineHeight: 1,
          marginTop: -Math.round(size * 0.04),
          textShadow: '0 1px 0 rgba(255,255,255,0.6)',
          fontFamily:
            '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        }}
      >
        {guess.emoji || '📦'}
      </span>
      {item.name ? (
        <span
          style={{
            position: 'absolute',
            left: 6,
            right: 6,
            bottom: labelBottom,
            textAlign: 'center',
            fontSize: labelSize,
            fontWeight: 700,
            color: labelColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: 0.2,
            opacity: 0.82,
          }}
        >
          {item.name}
        </span>
      ) : (
        <span style={{ position: 'absolute', bottom: 8, opacity: 0.4 }}>
          <PinIcon name="box" size={14} />
        </span>
      )}
    </div>
  );
}
