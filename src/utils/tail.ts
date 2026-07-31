import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import fs from 'node:fs';
export interface TailOptions {
    flushIncomplete?: boolean;
    polling?: boolean;
    pollingInterval?: number;
    nLines?: number;
}
interface QueueItem {
    readonly start: number;
    readonly end: number;
}
export class Tail extends EventEmitter {
    readonly #fd: number;
    readonly #filename: string;
    readonly #flushIncomplete: boolean;
    readonly #queue: QueueItem[] = [];
    readonly #internalDispatcher = new EventEmitter();
    readonly #watcher?: fs.FSWatcher;
    #buffer: Buffer = Buffer.alloc(0);
    #currentCursorPos: number = 0;
    #unwatched: boolean = false;
    static #POLLING_PREFERRED = process.platform !== 'darwin' && process.platform !== 'linux';
    constructor(filename: string, options: TailOptions = {}) {
        super();
        this.#filename = resolve(filename);
        this.#fd = fs.openSync(this.#filename, 'r');
        if (fs.fstatSync(this.#fd).isDirectory()) {
            fs.closeSync(this.#fd);
            throw new Error(`Cannot Tail a folder: ${this.#filename}`);
        }
        this.#flushIncomplete = options.flushIncomplete ?? false;
        this.#internalDispatcher.on('next', () => this.#readBlock());
        let cursor: number | undefined;
        const nLines = options.nLines ?? -1;
        if (nLines < 0)
            cursor = 0;
        else if (nLines === 0)
            cursor = this.#getCurrentFilePos();
        else
            cursor = this.#getInitialPositionAtNthLine(nLines);
        if (cursor === undefined) {
            fs.closeSync(this.#fd);
            throw new Error(`Tail failed to initialize for ${this.#filename}`);
        }
        this.#currentCursorPos = cursor;
        if (nLines !== 0)
            this.#change();
        try {
            const useWatchFile = options.polling ?? Tail.#POLLING_PREFERRED;
            if (useWatchFile) {
                const interval = options.pollingInterval ?? 1000;
                fs.watchFile(this.#filename, { interval }, (curr, prev) => this.#onWatchFileEvent(curr, prev));
            }
            else {
                this.#watcher = fs.watch(this.#filename, (event) => this.#onWatchEvent(event));
            }
        }
        catch (error) {
            this.unwatch();
            this.emit('error', new Error(`Tail watching for ${this.#filename} failed.`, { cause: error }));
        }
    }
    #getCurrentFilePos() {
        try {
            return fs.fstatSync(this.#fd).size;
        }
        catch (error) {
            this.#lostFile(error);
            return;
        }
    }
    #getInitialPositionAtNthLine(nLines: number): number {
        const { size } = fs.fstatSync(this.#fd);
        if (size === 0)
            return 0;
        const chunkSizeBytes = Math.min(1024, size);
        const buffer = Buffer.alloc(chunkSizeBytes);
        const lastByte = Buffer.allocUnsafe(1);
        fs.readSync(this.#fd, lastByte, 0, 1, size - 1);
        let linesFound = lastByte[0] === 0x0A ? 0 : 1;
        let currentReadPosition = size;
        while (currentReadPosition > 0) {
            const readSize = Math.min(chunkSizeBytes, currentReadPosition);
            currentReadPosition -= readSize;
            fs.readSync(this.#fd, buffer, 0, readSize, currentReadPosition);
            for (let i = readSize - 1; i >= 0; i--) {
                if (buffer[i] === 0x0A) {
                    if (linesFound === nLines)
                        return currentReadPosition + i + 1;
                    linesFound++;
                }
            }
        }
        return 0;
    }
    #readBlock() {
        if (this.#queue.length === 0)
            return;
        const block = this.#queue[0]!;
        if (block.end <= block.start)
            return;
        const stream = fs.createReadStream('', {
            start: block.start,
            end: block.end - 1,
            fd: this.#fd,
            autoClose: false,
        });
        stream.on('data', (d) => {
            const chunk = d as Buffer;
            this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
            let pos = 0;
            while (true) {
                const LF = this.#buffer.indexOf(0x0A, pos);
                if (LF === -1)
                    break;
                let end = LF;
                if (end > pos && this.#buffer[end - 1] === 0x0D)
                    end--;
                const line = this.#buffer.toString('utf8', pos, end);
                this.emit('line', line);
                pos = LF + 1;
            }
            if (pos > 0)
                this.#buffer = Buffer.from(this.#buffer.subarray(pos));
        });
        stream.on('end', () => {
            this.#queue.shift();
            if (this.#queue.length > 0)
                this.#internalDispatcher.emit('next');
            if (this.#flushIncomplete && this.#buffer.length > 0) {
                this.emit('line', this.#buffer.toString('utf8'));
                this.#buffer = Buffer.alloc(0);
            }
        });
        stream.on('error', (error) => this.emit('error', new Error('ReadStream error', { cause: error })));
    }
    #change(newPos?: number) {
        newPos ??= this.#getCurrentFilePos();
        if (newPos === undefined)
            return;
        if (newPos < this.#currentCursorPos)
            this.#currentCursorPos = 0;
        if (newPos > this.#currentCursorPos) {
            this.#queue.push({ start: this.#currentCursorPos, end: newPos });
            this.#currentCursorPos = newPos;
            if (this.#queue.length === 1)
                this.#internalDispatcher.emit('next');
        }
    }
    #onWatchEvent(evtName: 'change' | 'rename') {
        if (evtName === 'change')
            return this.#change();
        try {
            fs.accessSync(this.#filename, fs.constants.R_OK);
        }
        catch (error) {
            this.#lostFile(error);
        }
    }
    #onWatchFileEvent(curr: fs.Stats, _prev: fs.Stats) {
        if (curr.nlink !== 0)
            return this.#change(curr.size);
        this.#lostFile({ code: 'ENOENT', syscall: 'stat', path: this.#filename });
    }
    #lostFile(error: unknown) {
        this.unwatch();
        this.emit('error', new Error('File not available anymore.', { cause: error }));
    }
    public unwatch() {
        if (this.#unwatched)
            return;
        if (this.#watcher)
            this.#watcher.close();
        else
            fs.unwatchFile(this.#filename);
        try {
            fs.closeSync(this.#fd);
        }
        catch {
            void 0;
        }
        this.#internalDispatcher.removeAllListeners();
        this.#buffer = Buffer.alloc(0);
        this.#queue.length = 0;
        this.#unwatched = true;
    }
}
