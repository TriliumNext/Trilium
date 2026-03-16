export interface CodeFormatter {
    readonly name: string;
    canFormat(language: string): boolean;
    format(code: string, language: string): Promise<string>;
}

export class FormatterRegistry {
    private static instance: FormatterRegistry | null = null;
    private readonly formatters: CodeFormatter[] = [];

    static getInstance(): FormatterRegistry {
        if (!FormatterRegistry.instance) {
            FormatterRegistry.instance = new FormatterRegistry();
        }
        return FormatterRegistry.instance;
    }

    register(formatter: CodeFormatter): void {
        this.formatters.push(formatter);
    }

    getFormatterForLanguage(language: string): CodeFormatter | undefined {
        return this.formatters.find((f) => f.canFormat(language));
    }

    isLanguageSupported(language: string): boolean {
        return this.formatters.some((f) => f.canFormat(language));
    }
}
