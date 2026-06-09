// --- ELITE 90 · i18n Utilities
import { pt } from "./pt";
import { en } from "./en";

export type Locale = "pt-br" | "en";

export const translations = { "pt-br": pt, en } as const;

export function useTranslations(locale: Locale) {
  return translations[locale] ?? translations["pt-br"];
}

export function getLocaleFromUrl(url: URL): Locale {
  const [, lang] = url.pathname.split("/");
  if (lang === "en") return "en";
  return "pt-br";
}

export function localePath(locale: Locale, path: string = ""): string {
  if (locale === "pt-br") return `/${path}`.replace(/\/$/, "") || "/";
  return `/${locale}${path ? `/${path}` : ""}`;
}

export const locales: Locale[] = ["pt-br", "en"];

export const localeLabels: Record<Locale, string> = {
  "pt-br": "PT",
  en: "EN",
};
