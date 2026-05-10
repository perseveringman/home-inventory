import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean | string;
  onBack?: () => void;
  actions?: ReactNode;
}

export function Header({ title, subtitle, back, onBack, actions }: HeaderProps) {
  const navigate = useNavigate();
  const backHandler = () => {
    if (onBack) onBack();
    else if (typeof back === 'string') navigate(back);
    else navigate(-1);
  };
  return (
    <header className="flex items-center gap-3 px-4 md:px-6 pt-5 pb-4 bg-white/80 backdrop-blur sticky top-[48px] md:top-[52px] z-10 border-b border-slate-100">
      {back && (
        <button
          onClick={backHandler}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-ink-700"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg md:text-xl font-semibold text-ink-900 truncate">{title}</h1>
        {subtitle && (
          <p className="text-xs md:text-sm text-ink-500 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
