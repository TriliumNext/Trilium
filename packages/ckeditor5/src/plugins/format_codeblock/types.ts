export interface CodeFormatter {
    isLanguageSupported(language: string): boolean;
    format(code: string, language: string): Promise<string>;
}
