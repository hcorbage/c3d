import { createContext, useContext, useState, type ReactNode } from "react";
import { translations, type Language, type Translations } from "./translations";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("stl-enhancer-lang");
    return (saved === "pt-BR" || saved === "en") ? saved : "en";
  });

  function handleSetLanguage(lang: Language) {
    setLanguage(lang);
    localStorage.setItem("stl-enhancer-lang", lang);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t: translations[language] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
