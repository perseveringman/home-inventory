import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinIcon, stripLeadingEmoji, titleIcon } from './PinIcon';
import { Glyph } from './Glyph';

interface HeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean | string;
  onBack?: () => void;
  actions?: ReactNode;
}

export function Header({ title, subtitle, back, onBack, actions }: HeaderProps) {
  const navigate = useNavigate();
  const cleanTitle = stripLeadingEmoji(title);
  const backHandler = () => {
    if (onBack) onBack();
    else if (typeof back === 'string') navigate(back);
    else navigate(-1);
  };
  return (
    <header className="enamel-header flex items-center gap-4">
      {back && (
        <button
          onClick={backHandler}
          className="enamel-icon-btn flex items-center justify-center"
          aria-label="返回"
        >
          <Glyph name="arrow-left" size={18} />
        </button>
      )}
      {!back && <PinIcon name={titleIcon(title)} size={40} className="md:!w-12 md:!h-12" />}
      <div className="flex-1 min-w-0">
        <h1 className="enamel-title truncate">{cleanTitle || title}</h1>
        {subtitle && (
          <p className="eyebrow mt-1 truncate">{subtitle}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
