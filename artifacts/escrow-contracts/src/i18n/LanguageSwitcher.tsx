import { languageOptions } from './context';
import { useI18n } from './context';

export type LanguageSwitcherProps = {
  className?: string;
  ariaLabel?: string;
};

export function LanguageSwitcher({ className, ariaLabel = 'Select language' }: LanguageSwitcherProps) {
  const { language, setLanguage } = useI18n();

  return (
    <label className={className}>
      <span className="sr-only">{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        value={language}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
      >
        {languageOptions.map(({ code, label }) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </label>
  );
}