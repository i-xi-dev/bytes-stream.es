//

import { AbortError, InvalidStateError, Reading } from "./deps.ts";
import { _BytesBuffer } from "./bytes_buffer.ts";

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

/**
 * @experimental
 */
namespace BytesStream {
  // /**
  //  * The options for the `BytesStream.Reader` with the following optional fields.
  //  */
  // export type ReadingOptions = {
  //   /**
  //    * The total number of bytes in the byte stream.
  //    */
  //   totalByteLength?: int;

  //   // AbortSignalのreasonとtimeout()が標準化されたので、これは廃止する
  //   // /**
  //   //  * The number of milliseconds it takes for the `BytesStream.Reader.prototype.read` to end automatically.
  //   //  */
  //   // timeout?: number,

  //   /**
  //    * The `AbortSignal` object.
  //    */
  //   signal?: AbortSignal;
  // };

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
  export class ReadingTask extends Reading.Task<Uint8Array> {
    readonly #stream: Source;
    // readonly #abortController: AbortController;

    private constructor(stream: Source, options?: Reading.Options) {
      if (stream && (typeof stream === "object")) {
        // ok
      } else {
        throw new TypeError("stream");
      }

      super(options);
      this.#stream = stream;
      // this.#abortController = new AbortController();

      Object.freeze(this);
    }

    static create(stream: Source, options?: Reading.Options): ReadingTask {
      return new ReadingTask(stream, options);
    }

    override async run(): Promise<Uint8Array> {
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
      if (this._internal.state !== Reading.State.READY) {
        throw new InvalidStateError(`state is not READY`);
      }
      this._internal.state = Reading.State.RUNNING;

      if (this._signal instanceof AbortSignal) {
        // // ストリームの最後の読み取りがキューされるまでに中止通達されれば中断する
        // this._signal.addEventListener("abort", () => {
        //   stream.cancel()しても読取終了まで待ちになるので、reader.cancel()する
        //   void reader.cancel().catch(); // XXX closeで良い？ // → ループ内で中断判定するので何もしない
        // }, {
        //   once: true,
        //   passive: true,
        //   signal: this.#abortController.signal,
        // });

        // 既に中止通達されている場合はエラーとする //TODO this._signal.throwIfAborted
        if (this._signal.aborted === true) {
          throw new AbortError("already aborted"); // TODO this._signal.reasonが広く実装されたら、signal.reasonをthrowするようにする
        }
      } else if (this._signal === undefined) {
        // ok
      } else {
        throw new TypeError("options.signal");
      }

      const buffer: _BytesBuffer = new _BytesBuffer(
        (this._indeterminate === true) ? undefined : this._total,
      );

      try {
        // started
        this._notify("loadstart");

        for await (const chunk of asyncSource) {
          if (this._signal?.aborted === true) {
            // aborted or expired
            throw new AbortError("aborted"); // TODO this._signal.reasonが広く実装されたら、signal.reasonをthrowするようにする
          }

          if (chunk instanceof Uint8Array) {
            buffer.put(chunk);
            this._internal.loaded = buffer.position;
            this._notify("progress");
          } else {
            throw new TypeError("asyncSource");
          }
        }

        // completed
        this._internal.state = Reading.State.COMPLETED;
        // this._notify("load"); resolveされるのでわかる

        if (buffer.capacity !== buffer.position) {
          return buffer.slice();
        } else {
          return buffer.subarray();
        }
      } catch (exception) {
        if ((exception instanceof Error) && (exception.name === "AbortError")) {
          // ・呼び出し側のAbortControllerでreason省略でabortした場合
          // ・呼び出し側のAbortControllerでreason:AbortErrorでabortした場合
          this._internal.state = Reading.State.ABORTED;
          // this._notify("abort"); rejectされるのでわかる
        } else if (
          (exception instanceof Error) && (exception.name === "TimeoutError")
        ) {
          // ・AbortSignal.timeoutでabortされた場合
          // ・呼び出し側のAbortControllerでreason:TimeoutErrorでabortした場合
          this._internal.state = Reading.State.ABORTED; //TODO timeout独自のstateにする？
          // this._notify("timeout"); rejectされるのでわかる
        } else {
          // ・呼び出し側のAbortControllerでreason:AbortError,TimeoutError以外でabortした場合
          // ・その他のエラー
          this._internal.state = Reading.State.ERROR;
          // this._notify("error"); rejectされるのでわかる
        }
        throw exception;
      } finally {
        // // signalに追加したリスナーを削除
        // this.#abortController.abort();

        this._notify("loadend"); // "progress"は間引く可能性があるので、最終的にloadedがいくつなのかは"progress"ではわからない
      }
    }
  }
  Object.freeze(ReadingTask);
}
Object.freeze(BytesStream);

export { BytesStream };
