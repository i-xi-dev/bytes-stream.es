//

import {
  _ProgressEvent,
  AbortError,
  Integer,
  InvalidStateError,
} from "./deps.ts";
import { _BytesBuffer } from "./bytes_buffer.ts";

type int = number;

/**
 * 可読ストリームを読み取り、チャンクを返却する非同期ジェネレーターを返却
  // XXX ReadableStream自体が[Symbol.asyncIterator]を持つようになるので、そうなれば不要
 *
 * @experimental
 * @param streamReader The reader created from `ReadableStream`.
 * @returns チャンクを返却する非同期ジェネレーター
 */
async function* _streamToAsyncGenerator<T>(
  streamReader: ReadableStreamDefaultReader<T>,
): AsyncGenerator<T, void, void> {
  try {
    for (
      let i = await streamReader.read();
      (i.done !== true);
      i = await streamReader.read()
    ) {
      yield i.value;
    }
  } catch (exception) {
    void exception; // XXX
    return;
  }
}

// /**
//  * @experimental
//  */
// interface Task<T> {
//   state: Task.State;
//   progress: Task.Progress;
//   run: () => Promise<T>;
// }

/**
 * @experimental
 */
namespace Task {
  export const State = {
    READY: "ready",
    RUNNING: "running",
    COMPLETED: "completed",
    ABORTED: "aborted",
    ERROR: "error",
  } as const;
  export type State = typeof State[keyof typeof State];

  export type Progress = {
    loaded: int;
    total: int;
    lengthComputable: boolean;
  };
}

// const _ReaderReadyState = {
//   EMPTY: 0,
//   LOADING: 1,
//   DONE: 2,
// } as const;
// type _ReaderReadyState =
//   typeof _ReaderReadyState[keyof typeof _ReaderReadyState];

// function _translateState(state: Task.State): _ReaderReadyState {
//   switch (state) {
//     case Task.State.READY:
//       return _ReaderReadyState.EMPTY;
//     case Task.State.RUNNING:
//       return _ReaderReadyState.LOADING;
//     case Task.State.COMPLETED:
//     case Task.State.ABORTED:
//     case Task.State.ERROR:
//       return _ReaderReadyState.DONE;
//     default:
//       throw new TypeError("state");
//   }
// }

type _Internal = {
  state: Task.State;
  loadedByteLength: int;
  lastProgressNotifiedAt: number;
};

/**
 * @experimental
 */
namespace BytesStream {
  /**
   * The options for the `BytesStream.Reader` with the following optional fields.
   */
  export type ReadingOptions = {
    /**
     * The total number of bytes in the byte stream.
     */
    totalByteLength?: int;

    // AbortSignalのreasonとtimeout()が標準化されたので、これは廃止する
    // /**
    //  * The number of milliseconds it takes for the `BytesStream.Reader.prototype.read` to end automatically.
    //  */
    // timeout?: number,

    /**
     * The `AbortSignal` object.
     */
    signal?: AbortSignal;
  };

  /**
   * The [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) of `Uint8Array` or the async iterator of `Uint8Array`.
   *
   * @experimental
   */
  export type Source =
    | AsyncIterable<Uint8Array>
    | ReadableStream<Uint8Array>
    | Iterable<Uint8Array>;
  // XXX ReadableStream<Uint8Array>は、そのうちAsyncIterable<Uint8Array>になる

  /**
   * @experimental
   */
  export class ReadingTask
    extends EventTarget /* implements Task<Uint8Array> */ {
    #stream: Source;
    #totalByteLength: int;
    #indeterminate: boolean;
    #signal: AbortSignal | undefined;
    // #abortController: AbortController;
    #progress: Task.Progress;
    #internal: _Internal;

    private constructor(stream: Source, options?: ReadingOptions) {
      if (stream && (typeof stream === "object")) {
        // ok
      } else {
        throw new TypeError("stream");
      }

      super();
      this.#stream = stream;

      const totalByteLength: number | undefined = options?.totalByteLength;
      if (typeof totalByteLength === "number") {
        if (Integer.isNonNegativeInteger(totalByteLength) !== true) {
          throw new RangeError("options.totalByteLength");
        }
      } else if (totalByteLength === undefined) {
        // ok
      } else {
        throw new TypeError("options.totalByteLength");
      }
      this.#totalByteLength = totalByteLength ?? 0;
      this.#indeterminate = typeof totalByteLength !== "number";
      // this.#abortController = new AbortController();
      this.#signal = options?.signal;

      // deno-lint-ignore no-this-alias
      const self = this;
      this.#progress = Object.freeze({
        get loaded() {
          return self.#internal.loadedByteLength;
        },
        get total() {
          return self.#totalByteLength;
        },
        get lengthComputable() {
          return (self.#indeterminate !== true);
        },
      });

      this.#internal = Object.seal({
        state: Task.State.READY,
        loadedByteLength: 0,
        lastProgressNotifiedAt: Number.MIN_VALUE,
      });
      Object.freeze(this);
    }

    static create(stream: Source, options?: ReadingOptions): ReadingTask {
      return new ReadingTask(stream, options);
    }

    get state(): Task.State {
      return this.#internal.state;
    }

    get progress(): Task.Progress {
      return this.#progress;
    }

    // XXX 要るか？
    // get readyState(): _ReaderReadyState {
    //   return _translateState(this.#internal.state);
    // }

    #notify(name: string): void {
      if (name === "progress") {
        const now = globalThis.performance.now();
        if ((this.#internal.lastProgressNotifiedAt + 50) > now) {
          return;
        }
        this.#internal.lastProgressNotifiedAt = now;
      }

      const event = new _ProgressEvent(name, this.progress);
      this.dispatchEvent(event);
    }

    async run(): Promise<Uint8Array> {
      if (
        Reflect.has(this.#stream, Symbol.asyncIterator) ||
        Reflect.has(this.#stream, Symbol.iterator)
      ) {
        try {
          const result = await this.#readAsyncIterable(
            this.#stream as AsyncIterable<Uint8Array>,
          );
          return result;
        } catch (exception) {
          if (this.#stream instanceof ReadableStream) {
            this.#stream.cancel();
          }
          throw exception;
        }
      } else if (this.#stream instanceof ReadableStream) {
        // ReadableStreamに[Symbol.asyncIterator]が未実装の場合
        const reader = this.#stream.getReader();
        try {
          const result = await this.#readAsyncIterable(
            _streamToAsyncGenerator<Uint8Array>(reader),
          );
          return result;
        } catch (exception) {
          reader.cancel();
          throw exception;
        }
      } else {
        throw new TypeError("#stream");
      }
    }

    async #readAsyncIterable(
      asyncSource: AsyncIterable<Uint8Array>,
    ): Promise<Uint8Array> {
      if (this.#internal.state !== Task.State.READY) {
        throw new InvalidStateError(`state is not READY`);
      }
      this.#internal.state = Task.State.RUNNING;

      if (this.#signal instanceof AbortSignal) {
        // // ストリームの最後の読み取りがキューされるまでに中止通達されれば中断する
        // this.#signal.addEventListener("abort", () => {
        //   stream.cancel()しても読取終了まで待ちになるので、reader.cancel()する
        //   void reader.cancel().catch(); // XXX closeで良い？ // → ループ内で中断判定するので何もしない
        // }, {
        //   once: true,
        //   passive: true,
        //   signal: this.#abortController.signal,
        // });

        // 既に中止通達されている場合はエラーとする //TODO this.#signal.throwIfAborted
        if (this.#signal.aborted === true) {
          throw new AbortError("already aborted"); // TODO this.#signal.reasonが広く実装されたら、signal.reasonをthrowするようにする
        }
      } else if (this.#signal === undefined) {
        // ok
      } else {
        throw new TypeError("options.signal");
      }

      const buffer: _BytesBuffer = new _BytesBuffer(
        (this.#indeterminate === true) ? undefined : this.#totalByteLength,
      );

      try {
        // started
        this.#notify("loadstart");

        for await (const chunk of asyncSource) {
          if (this.#signal?.aborted === true) {
            // aborted or expired
            throw new AbortError("aborted"); // TODO this.#signal.reasonが広く実装されたら、signal.reasonをthrowするようにする
          }

          if (chunk instanceof Uint8Array) {
            buffer.put(chunk);
            this.#internal.loadedByteLength = buffer.position;
            this.#notify("progress");
          } else {
            throw new TypeError("asyncSource");
          }
        }

        // completed
        this.#internal.state = Task.State.COMPLETED;
        // this.#notify("load"); resolveされるのでわかる

        if (buffer.capacity !== buffer.position) {
          return buffer.slice();
        } else {
          return buffer.subarray();
        }
      } catch (exception) {
        if ((exception instanceof Error) && (exception.name === "AbortError")) {
          // ・呼び出し側のAbortControllerでreason省略でabortした場合
          // ・呼び出し側のAbortControllerでreason:AbortErrorでabortした場合
          this.#internal.state = Task.State.ABORTED;
          // this.#notify("abort"); rejectされるのでわかる
        } else if (
          (exception instanceof Error) && (exception.name === "TimeoutError")
        ) {
          // ・AbortSignal.timeoutでabortされた場合
          // ・呼び出し側のAbortControllerでreason:TimeoutErrorでabortした場合
          this.#internal.state = Task.State.ABORTED; //TODO timeout独自のstateにする？
          // this.#notify("timeout"); rejectされるのでわかる
        } else {
          // ・呼び出し側のAbortControllerでreason:AbortError,TimeoutError以外でabortした場合
          // ・その他のエラー
          this.#internal.state = Task.State.ERROR;
          // this.#notify("error"); rejectされるのでわかる
        }
        throw exception;
      } finally {
        // // signalに追加したリスナーを削除
        // this.#abortController.abort();

        this.#notify("loadend"); // "progress"は間引く可能性があるので、最終的にloadedがいくつなのかは"progress"ではわからない
      }
    }
  }
  Object.freeze(ReadingTask);
}
Object.freeze(BytesStream);

export { BytesStream };
