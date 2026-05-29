// ---------------------------------------------------------------------------
//  i18n. EN default, AR available. Persists the user's choice in
//  localStorage and reflects it on <html dir="..."> so the existing CSS
//  can flip layouts for RTL.
//
//  Pattern for adding a new translated surface:
//    1. Add keys to both locales/en.json and locales/ar.json (same shape).
//    2. In the component:  const { t } = useTranslation();
//       and replace the literal with  t('namespace.key', { var: x }).
//    3. No code change here.
// ---------------------------------------------------------------------------
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ar from '../locales/ar.json';

const STORE_KEY = 'spd_lang';

function detectInitialLanguage() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch { /* localStorage may be blocked */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: detectInitialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

// Keep <html lang> and <html dir> in sync with i18n's current language.
function applyHtmlAttrs(lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
applyHtmlAttrs(i18n.language);
i18n.on('languageChanged', (lang) => {
  applyHtmlAttrs(lang);
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* */ }
});

export default i18n;
export function setLanguage(lang) {
  return i18n.changeLanguage(lang);
}
