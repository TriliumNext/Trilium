import utils from "../services/utils.js";
import type { CommandMappings, CommandNames, EventData, EventNames } from "./app_context.js";

/**
 * Abstract class for all components in the Trilium's frontend.
 *
 * Contains also event implementation with following properties:
 * - event / command distribution is synchronous which among others mean that events are well-ordered - event
 *   which was sent out first will also be processed first by the component
 * - execution of the event / command is asynchronous - each component executes the event on its own without regard for
 *   other components.
 * - although the execution is async, we are collecting all the promises, and therefore it is possible to wait until the
 *   event / command is executed in all components - by simply awaiting the `triggerEvent()`.
 */
export class TypedComponent<ChildT extends TypedComponent<ChildT>> {
    $widget!: JQuery<HTMLElement>;
    componentId: string;
    children: ChildT[];
    initialized: Promise<void> | null;
    parent?: TypedComponent<any>;
    _position!: number;

    constructor() {
        this.componentId = `${this.sanitizedClassName}-${utils.randomString(8)}`;
        this.children = [];
        this.initialized = null;
    }

    get sanitizedClassName() {
        // webpack mangles names and sometimes uses unsafe characters
        return this.constructor.name.replace(/[^A-Z0-9]/gi, "_");
    }

    get position() {
        return this._position;
    }

    set position(newPosition: number) {
        this._position = newPosition;
    }

    setParent(parent: TypedComponent<any>) {
        this.parent = parent;
        return this;
    }

    child(...components: ChildT[]) {
        for (const component of components) {
            component.setParent(this);

            this.children.push(component);
        }

        return this;
    }

    handleEvent<T extends EventNames>(name: T, data: EventData<T>): Promise<unknown[] | unknown> | null | undefined {
        try {
            const callMethodPromise = this.initialized ? this.initialized.then(() => this.callMethod((this as any)[`${name}Event`], data)) : this.callMethod((this as any)[`${name}Event`], data);

            const childrenPromise = this.handleEventInChildren(name, data);

            // don't create promises if not needed (optimization)
            return callMethodPromise && childrenPromise ? Promise.all([callMethodPromise, childrenPromise]) : callMethodPromise || childrenPromise;
        } catch (e: any) {
            console.error(`Handling of event '${name}' failed in ${this.constructor.name} with error ${e.message} ${e.stack}`);

            return null;
        }
    }

    triggerEvent<T extends EventNames>(name: T, data: EventData<T>): Promise<unknown> | undefined | null {
        return this.parent?.triggerEvent(name, data);
    }

    handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>): Promise<unknown[] | unknown> | null {
        const promises: Promise<unknown>[] = [];

        for (const child of this.children) {
            const ret = child.handleEvent(name, data) as Promise<void>;

            if (ret) {
                promises.push(ret);
            }
        }

        // don't create promises if not needed (optimization)
        return promises.length > 0 ? Promise.all(promises) : null;
    }

    triggerCommand<K extends CommandNames>(name: K, data?: CommandMappings[K]): Promise<unknown> | undefined | null {
        const fun = (this as any)[`${name}Command`];

        if (fun) {
            return this.callMethod(fun, data);
        } else if (this.parent) {
            return this.parent.triggerCommand(name, data);
        }
    }

    callMethod(fun: (arg: unknown) => Promise<unknown>, data: unknown) {
        if (typeof fun !== "function") {
            return;
        }

        const startTime = Date.now();

        const promise = fun.call(this, data);

        const took = Date.now() - startTime;

        if (glob.isDev && took > 20) {
            // measuring only sync handlers
            console.log(`Call to ${fun.name} in ${this.componentId} took ${took}ms`);
        }

        if (glob.isDev && promise) {
            return utils.timeLimit(promise, 20000, `Time limit failed on ${this.constructor.name} with ${fun.name}`);
        }

        return promise;
    }
}

export default class Component extends TypedComponent<Component> {}
