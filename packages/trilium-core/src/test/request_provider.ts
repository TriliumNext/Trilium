/**
 * A {@link RequestProvider} standing in for the real one, with only the parts a given test needs.
 *
 * Every test that installs a provider wants one or two of its methods and has no opinion about the
 * rest, and writing the rest out by hand meant that adding a method to the interface broke six
 * unrelated specs at once. Here the unstubbed parts fail loudly instead, which is what a test that
 * reaches one of them should do — it has wandered somewhere it did not mean to go.
 */

import type { FetchedResource, FetchResourceOpts, ExecOpts, RequestProvider } from "../services/request.js";

export function fakeRequestProvider(overrides: Partial<RequestProvider> = {}): RequestProvider {
    return {
        exec: <T,>(_opts: ExecOpts): Promise<T> => unstubbed("exec"),
        getImage: (_imageUrl: string): Promise<ArrayBuffer> => unstubbed("getImage"),
        fetchResource: (_url: string, _opts: FetchResourceOpts): Promise<FetchedResource> => unstubbed("fetchResource"),
        ...overrides
    };
}

function unstubbed(method: string): never {
    throw new Error(`This test installed a request provider without ${method}(), and something called it.`);
}
