import { useState } from 'react';
import { PinIcon } from './PinIcon';

interface Props {
  /** 远程 url 或内联 dataURL */
  iconUrl?: string;
  /** 短文字标识（如 NF），无图标时展示 */
  label?: string;
  /** 订阅名，用于兜底首字与配色 */
  name?: string;
  size?: number;
  className?: string;
}

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = text.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

/**
 * 订阅图标：优先展示真实应用图标（App Store / 用户上传），
 * 失败或缺失时回退到「短标识 / 名称首字」的彩色圆角块，
 * 再不行回退到默认订阅 PinIcon。
 */
export function SubIcon({ iconUrl, label, name = '', size = 44, className = '' }: Props) {
  const [broken, setBroken] = useState(false);
  const radius = Math.round(size * 0.26);

  if (iconUrl && !broken) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setBroken(true)}
        className={`sub-icon object-cover shadow-soft shrink-0 ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  const text = (label || name).trim();
  if (text) {
    const hue = hashHue(text);
    const glyph = text.length <= 2 ? text : Array.from(text)[0];
    return (
      <span
        className={`sub-icon inline-flex items-center justify-center font-display text-white shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          fontSize: Math.round(size * 0.4),
          background: `linear-gradient(135deg, hsl(${hue},72%,58%), hsl(${(hue + 28) % 360},72%,48%))`,
        }}
        aria-hidden="true"
      >
        {glyph}
      </span>
    );
  }

  return <PinIcon name="subscribe" size={size} className={className} />;
}
