export interface CodeFormatter {
    readonly name: string;
    canFormat(language: string): boolean;
    format(code: string, language: string): Promise<string>;
}

export class FormatterRegistry {
    private readonly formatters: CodeFormatter[] = [];

    register(formatter: CodeFormatter): void {
        this.formatters.push(formatter);
    }

    getFormatterForLanguage(language: string): CodeFormatter | undefined {
        return this.formatters.find((f) => f.canFormat(language));
    }

    isLanguageSupported(language: string): boolean {
        return this.formatters.some((f) => f.canFormat(language));
    }

    format(code: string, language: string): Promise<string> {
        const formatter = this.getFormatterForLanguage(language);
        if (!formatter) {
            return Promise.reject(new Error(`No formatter available for language: ${language}`));
        }
        return formatter.format(code, language);
    }
}
