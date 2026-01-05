import { ExecutionContext } from "@triliumnext/core";
import clsHooked from "cls-hooked";

const namespace = clsHooked.createNamespace("trilium");

export default class ClsHookedExecutionContext implements ExecutionContext {

    get<T = any>(key: string): T | undefined {
        return namespace.get(key);
    }

    set(key: string, value: any): void {
        namespace.set(key, value);
    }

    reset(): void {
        clsHooked.reset();
    }

    init<T>(callback: () => T): T {
        return namespace.runAndReturn(callback);
    }

}
