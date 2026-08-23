import en from "./en.json";
import zhCN from "./zh-CN.json";
import ja from "./ja.json";
import ko from "./ko.json";
import es from "./es.json";
import fr from "./fr.json";
import de from "./de.json";
import ptBR from "./pt-BR.json";
import type { AppLocale } from "./locales";

/** English is the source-of-truth catalog; keys are typed from it. */
export const enMessages = en;

// Keep untranslated keys on the English fallback path without copying new
// English strings into the locale JSON catalogs. This preserves the catalog
// parity contract while letting each locale fall back normally at runtime.
function withEnglishFallback(catalog: Readonly<Record<string, string>>): Record<string, string> {
	return { ...enMessages, ...catalog };
}

export const zhCNMessages = withEnglishFallback(zhCN);
export const jaMessages = withEnglishFallback(ja);
export const koMessages = withEnglishFallback(ko);
export const esMessages = withEnglishFallback(es);
export const frMessages = withEnglishFallback(fr);
export const deMessages = withEnglishFallback(de);
export const ptBRMessages = withEnglishFallback(ptBR);

export type MessageKey = keyof typeof enMessages;

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralMessageKey = MessageKey extends infer Key extends string
	? Key extends `${infer Base}_${PluralCategory}`
		? Base
		: never
	: never;

export type MessageCatalog = Record<MessageKey, string>;

const catalogs: Record<AppLocale, Readonly<Record<string, string>>> = {
	en: enMessages,
	"zh-CN": zhCNMessages,
	ja: jaMessages,
	ko: koMessages,
	es: esMessages,
	fr: frMessages,
	de: deMessages,
	"pt-BR": ptBRMessages,
};

export function catalogFor(locale: AppLocale): Readonly<Record<string, string>> {
	return catalogs[locale] ?? catalogs.en;
}
