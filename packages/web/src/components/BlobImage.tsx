import { useEffect, useState, ImgHTMLAttributes } from 'react';

const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect fill="#e2e8f0" width="120" height="120" rx="16"/><text x="60" y="65" text-anchor="middle" font-size="36">📦</text></svg>'
  );

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  blob?: Blob | null;
  /** fallback emoji 显示（blob 为空或失败时） */
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
          className={`flex items-center justify-center bg-slate-100 text-3xl ${
            className ?? ''
          }`}
        >
          {emoji}
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
