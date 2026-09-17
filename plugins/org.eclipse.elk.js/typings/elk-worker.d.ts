/**
 * An in-process stand-in for a Web Worker that runs layouts on this thread, for
 * `new ELK({ workerFactory: () => new Worker() })` in Node.js and Bun.
 */
export declare class Worker {
    constructor();
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown): void;
    terminate(): void;
}
