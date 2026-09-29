import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ar from './ar.json';
import zhCN from './zh-CN.json';
import id from './id.json';
import vi from './vi.json';

export const catalogs = { en, ar, 'zh-CN': zhCN, id, vi } as const;
export type Language = keyof typeof catalogs;
export type TranslationCatalog = typeof en;

type LeafPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
    }[keyof T & string];

export type TranslationKey = LeafPaths<TranslationCatalog>;
export type TranslationValues = Record<string, string | number>;

export const languageOptions: ReadonlyArray<{ code: Language; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tiếng Việt' },
];

const STORAGE_KEY = 'pitrust-language';
const LEGACY_STORAGE_KEY = 'pactline-language';
const rtlLanguages: ReadonlySet<Language> = new Set(['ar']);

function isLanguage(value: string | null): value is Language {
  return value !== null && Object.prototype.hasOwnProperty.call(catalogs, value);
}

function getInitialLanguage(): Language {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLanguage(saved)) return saved;
      const legacySaved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (isLanguage(legacySaved)) {
        window.localStorage.setItem(STORAGE_KEY, legacySaved);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        return legacySaved;
      }
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
    const browserLanguage = window.navigator.language;
    if (browserLanguage.toLowerCase().startsWith('ar')) return 'ar';
    if (browserLanguage.toLowerCase().startsWith('zh')) return 'zh-CN';
    if (browserLanguage.toLowerCase().startsWith('id')) return 'id';
    if (browserLanguage.toLowerCase().startsWith('vi')) return 'vi';
  }
  return 'en';
}

function readTranslation(language: Language, key: TranslationKey): string {
  const result = key.split('.').reduce<unknown>((value, part) => {
    if (value !== null && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalogs[language]);
  return typeof result === 'string' ? result : key;
}

type I18nContextValue = {
  language: Language;
  direction: 'ltr' | 'rtl';
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export type I18nProviderProps = {
  children: ReactNode;
  initialLanguage?: Language;
};

export function I18nProvider({ children, initialLanguage }: I18nProviderProps) {
  const [language, setLanguage] = useState<Language>(initialLanguage ?? getInitialLanguage);
  const direction = rtlLanguages.has(language) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // The selected language remains active for this session if storage is unavailable.
    }
  }, [language, direction]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    direction,
    setLanguage,
    t: (key, values) => {
      const message = readTranslation(language, key);
      if (!values) return message;
      return message.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => (
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
      ));
    },
  }), [language, direction]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within an I18nProvider.');
  return context;
}