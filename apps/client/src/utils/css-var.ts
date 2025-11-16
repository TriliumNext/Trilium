export function readCssVar(element: HTMLElement, varName: string) {
    return new CssVarReader(getComputedStyle(element).getPropertyValue("--" + varName));
}

export class CssVarReader {
    protected value: string;

    constructor(rawValue: string) {
        this.value = rawValue;
    }

    asString(defaultValue?: string) {
        return (this.value) ? this.value : defaultValue;
    }

    asNumber(defaultValue?: number) {
        let number: Number = NaN;

        if (this.value) {
            number = parseFloat(this.value);
        }

        return (!isNaN(number.valueOf()) ? number.valueOf() : defaultValue)
    }

    asBoolean(defaultValue?: boolean) {
        let value = this.value.toLocaleLowerCase().trim();
        let result: boolean | undefined;

        switch (value) {
            case "true":
            case "1":
                result = true;
                break;
            case "false":
            case "0":
                result = false;
                break;
        }

        return (result !== undefined) ? result : defaultValue;
    }

    asEnum<T>(enumType: T, defaultValue?: T[keyof T]): T[keyof T] | undefined {
        let result: T[keyof T] | undefined;

        result = enumType[this.value as keyof T];
       
        if (result === undefined) {
            result = defaultValue;
        }

        return result;
    }

    asArray(delimiter: string = " "): CssVarReader[] {
        // Note: ignoring delimiters inside quotation marks is currently unsupported
        let values = this.value.split(delimiter);
        
        return values.map((v) => new CssVarReader(v));
    }

}