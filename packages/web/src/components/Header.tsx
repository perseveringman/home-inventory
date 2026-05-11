import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinIcon, stripLeadingEmoji, titleIcon } from './PinIcon';

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
    <header className="enamel-header flex items-center gap-3 px-4 md:px-6 pt-5 pb-4 bg-white/80 backdrop-blur sticky top-[48px] md:top-[52px] z-10 border-b border-slate-100">
      {back && (
        <button
          onClick={backHandler}
          className="enamel-icon-btn w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-ink-700"
        >
          <PinIcon name="back" size={30} tile={false} />
        </button>
      )}
      {!back && <PinIcon name={titleIcon(title)} size={44} />}
      <div className="flex-1 min-w-0">
        <h1 className="enamel-title text-lg md:text-xl font-semibold text-ink-900 truncate">{cleanTitle || title}</h1>
        {subtitle && (
          <p className="text-xs md:text-sm text-ink-500 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
