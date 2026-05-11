import { useEffect, useState, ImgHTMLAttributes } from 'react';
import { PinIcon } from './PinIcon';

const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect x="10" y="10" width="100" height="100" rx="32" fill="#eef1f5"/><path d="M36 48 60 34l24 14-24 14-24-14Z" fill="#ffb14a" stroke="#171717" stroke-width="7" stroke-linejoin="round"/><path d="M36 48v28l24 14 24-14V48" fill="#d88738" stroke="#171717" stroke-width="7" stroke-linejoin="round"/><path d="M60 62v28" stroke="#171717" stroke-width="7" stroke-linecap="round"/><path d="M44 51v14l12 6" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>'
  );

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  blob?: Blob | null;
  /** fallback marker used when blob is empty or fails to load */
  emoji?: string;
}

export function BlobImage({ blob, emoji, className, alt = '', ...rest }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || !(blob instanceof Blob) || blob.size < 8) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  if (!url) {
    if (emoji) {
      return (
        <div
          className={`sticker-image flex items-center justify-center bg-slate-100 ${
            className ?? ''
          }`}
        >
          <PinIcon name="box" size={54} />
        </div>
      );
    }
    return <img src={PLACEHOLDER} className={className} alt={alt} {...rest} />;
  }

  return (
    <img
      src={url}
      className={className}
      alt={alt}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
      }}
      {...rest}
    />
  );
}
