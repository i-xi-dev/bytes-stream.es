import { assertStrictEquals } from "std/testing/asserts";
import { BytesStream } from "../mod.ts";

// function wait(ms: number) {
//   return new Promise<void>((resolve) => {
//     setTimeout(() => {
//       resolve();
//     }, ms);
//   });
// }

function createStream(length: number) {
  // deno-lint-ignore no-explicit-any
  let ti: any;
  return new ReadableStream({
    start(controller: ReadableStreamDefaultController) {
      let c = 0;
      ti = setInterval(() => {
        if (c >= length) {
          clearInterval(ti);
          controller.close();
          return;
        }
        c = c + 1;

        controller.enqueue(Uint8Array.of(255));
      }, 10);
    },
    cancel() {
      clearInterval(ti);
    },
  });
}

Deno.test("new BytesStream.ReadingTask(ReadableStream)", async () => {
  const s1 = createStream(8);

  const task1 = BytesStream.ReadingTask.create(s1);
  const bs1 = await task1.run();

  assertStrictEquals(bs1.byteLength, 8);

  try {
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "InvalidStateError");
    assertStrictEquals(err.message, "state is not READY");
  }
});

Deno.test("new BytesStream.ReadingTask(AsyncIterable<Uint8Array>)", async () => {
  const ai1 = async function* () {
    yield Uint8Array.of(1);
    yield Uint8Array.of(2, 3);
  };
  const task1 = BytesStream.ReadingTask.create(ai1());
  const bs1 = await task1.run();
  assertStrictEquals(bs1.byteLength, 3);

  // deno-lint-ignore require-yield
  const ai2 = async function* (): AsyncGenerator<Uint8Array, void, void> {
    return;
  };
  const reader2 = BytesStream.ReadingTask.create(ai2());
  const bs2 = await reader2.run();
  assertStrictEquals(bs2.byteLength, 0);
});

Deno.test("new BytesStream.ReadingTask(AsyncIterable<*>)", async () => {
  const ai1 = async function* () {
    yield 1;
    yield 2;
  };
  const task1 = BytesStream.ReadingTask.create(
    ai1() as unknown as AsyncIterable<Uint8Array>,
  );
  try {
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "TypeError");
    assertStrictEquals(err.message, "asyncSource");
  }
});

Deno.test("new BytesStream.ReadingTask(*)", async () => {
  try {
    const task1 = BytesStream.ReadingTask.create(
      3 as unknown as AsyncIterable<Uint8Array>,
    );
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "TypeError");
    assertStrictEquals(err.message, "stream");
  }
});

Deno.test("new BytesStream.ReadingTask(Iterable<Uint8Array>)", async () => {
  const task1 = BytesStream.ReadingTask.create([
    Uint8Array.of(1),
    Uint8Array.of(2, 3),
  ]);
  const bs1 = await task1.run();
  assertStrictEquals(bs1.byteLength, 3);

  const reader2 = BytesStream.ReadingTask.create([] as Uint8Array[]);
  const bs2 = await reader2.run();
  assertStrictEquals(bs2.byteLength, 0);
});

Deno.test("new BytesStream.ReadingTask(Iterable<*>)", async () => {
  try {
    const task1 = BytesStream.ReadingTask.create(
      [3] as unknown as Iterable<Uint8Array>,
    );
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "TypeError");
    assertStrictEquals(err.message, "asyncSource");
  }
});

Deno.test("new BytesStream.ReadingTask(ReadableStream, {totalByteLength: number})", async () => {
  const s1 = createStream(8);
  const task1 = BytesStream.ReadingTask.create(s1, { totalByteLength: 8 });
  const bs1 = await task1.run();
  assertStrictEquals(bs1.byteLength, 8);
  assertStrictEquals(bs1.buffer.byteLength, 8);

  const s2 = createStream(8);
  const reader2 = BytesStream.ReadingTask.create(s2, { totalByteLength: 9 });
  const bs2 = await reader2.run();
  assertStrictEquals(bs2.byteLength, 8);
  assertStrictEquals(bs2.buffer.byteLength, 8);

  const s3 = createStream(8);
  const reader3 = BytesStream.ReadingTask.create(s3, { totalByteLength: 7 });
  const bs3 = await reader3.run();
  assertStrictEquals(bs3.byteLength, 8);
  assertStrictEquals(bs3.buffer.byteLength, 8);

  const s4 = createStream(8);
  const reader4 = BytesStream.ReadingTask.create(s4, { totalByteLength: 0 });
  const bs4 = await reader4.run();
  assertStrictEquals(bs4.byteLength, 8);
  assertStrictEquals(bs4.buffer.byteLength, 8);

  const s5 = createStream(8);
  const reader5 = BytesStream.ReadingTask.create(s5, {
    totalByteLength: undefined,
  });
  const bs5 = await reader5.run();
  assertStrictEquals(bs5.byteLength, 8);
  assertStrictEquals(bs5.buffer.byteLength, 8);
});

Deno.test("new BytesStream.ReadingTask(ReadableStream, {totalByteLength:number}) - error", async () => {
  try {
    const task1 = BytesStream.ReadingTask.create([], { totalByteLength: -1 });
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "RangeError");
    assertStrictEquals(err.message, "options.totalByteLength");
  }

  try {
    const reader2 = BytesStream.ReadingTask.create([], {
      totalByteLength: "1" as unknown as number,
    });
    await reader2.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "TypeError");
    assertStrictEquals(err.message, "options.totalByteLength");
  }
});

Deno.test("new BytesStream.ReadingTask(ReadableStream, {signal:AbortSignal})", async () => {
  const s1 = createStream(100);
  const ac1 = new AbortController();
  try {
    const task1 = BytesStream.ReadingTask.create(s1, { signal: ac1.signal });
    setTimeout(() => {
      ac1.abort();
    }, 5);
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "AbortError");
  }
});

Deno.test("new BytesStream.ReadingTask(ReadableStream, {signal:AbortSignal}) - error", async () => {
  const s2 = createStream(100);
  try {
    const reader2 = BytesStream.ReadingTask.create(s2, {
      signal: {} as unknown as AbortSignal,
    });
    await reader2.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "TypeError");
  }
});

Deno.test("new BytesStream.ReadingTask(ReadableStream, {signal:AbortSignal}) - abort", async () => {
  const s2 = createStream(100);
  const ac2 = new AbortController();
  ac2.abort();
  try {
    const reader2 = BytesStream.ReadingTask.create(s2, { signal: ac2.signal });
    await reader2.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "AbortError");
    assertStrictEquals(err.message, "already aborted");
  }
});

Deno.test("new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.onprogress", async () => {
  const s1 = createStream(8);
  const task1 = BytesStream.ReadingTask.create(s1);

  let loadedLength = -1;
  let totalLength = -1;
  let lengthComputable = undefined;
  const names: string[] = [];
  const listener = (e: ProgressEvent) => {
    names.push(e.type);
    loadedLength = e.loaded;
    totalLength = e.total;
    lengthComputable = e.lengthComputable;
  };

  // task1.addEventListener("loadstart", listener as EventListener);
  // task1.addEventListener("load", listener as EventListener);
  // task1.addEventListener("progress", listener as EventListener);
  // task1.addEventListener("abort", listener as EventListener);
  // task1.addEventListener("timeout", listener as EventListener);
  // task1.addEventListener("error", listener as EventListener);
  // task1.addEventListener("loadend", listener as EventListener);
  task1.onprogress = listener;

  const bs1 = await task1.run();
  assertStrictEquals(bs1.byteLength, 8);
  assertStrictEquals(loadedLength, 8);
  assertStrictEquals(totalLength, 0);
  assertStrictEquals(lengthComputable, false);
  // assertStrictEquals(names.filter((n) => n === "loadstart").length, 1);
  // assertStrictEquals(names.filter((n) => n === "load").length, 1);
  assertStrictEquals(names.filter((n) => n === "progress").length >= 1, true);
  // assertStrictEquals(names.filter((n) => n === "abort").length, 0);
  // assertStrictEquals(names.filter((n) => n === "timeout").length, 0);
  // assertStrictEquals(names.filter((n) => n === "error").length, 0);
  // assertStrictEquals(names.filter((n) => n === "loadend").length, 1);
});

Deno.test("new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.onprogress - total", async () => {
  const s1 = createStream(8);
  const task1 = BytesStream.ReadingTask.create(s1, { totalByteLength: 200 });

  let loadedLength = -1;
  let totalLength = -1;
  let lengthComputable = undefined;
  const names: string[] = [];
  const listener = (e: ProgressEvent) => {
    names.push(e.type);
    loadedLength = e.loaded;
    totalLength = e.total;
    lengthComputable = e.lengthComputable;
  };

  // task1.addEventListener("loadstart", listener as EventListener);
  // task1.addEventListener("load", listener as EventListener);
  // task1.addEventListener("progress", listener as EventListener);
  // task1.addEventListener("abort", listener as EventListener);
  // task1.addEventListener("timeout", listener as EventListener);
  // task1.addEventListener("error", listener as EventListener);
  // task1.addEventListener("loadend", listener as EventListener);
  task1.onprogress = listener;

  const bs1 = await task1.run();
  assertStrictEquals(bs1.byteLength, 8);
  assertStrictEquals(loadedLength, 8);
  assertStrictEquals(totalLength, 200);
  assertStrictEquals(lengthComputable, true);
  // assertStrictEquals(names.filter((n) => n === "loadstart").length, 1);
  // assertStrictEquals(names.filter((n) => n === "load").length, 1);
  assertStrictEquals(names.filter((n) => n === "progress").length >= 1, true);
  // assertStrictEquals(names.filter((n) => n === "abort").length, 0);
  // assertStrictEquals(names.filter((n) => n === "timeout").length, 0);
  // assertStrictEquals(names.filter((n) => n === "error").length, 0);
  // assertStrictEquals(names.filter((n) => n === "loadend").length, 1);
});

Deno.test("new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.onprogress - abort", async () => {
  const s1 = createStream(8);
  const ac1 = new AbortController();
  const task1 = BytesStream.ReadingTask.create(s1, { signal: ac1.signal });
  let loadedLength = -1;
  let totalLength = -1;
  let lengthComputable = undefined;
  const names: string[] = [];
  const listener = (e: ProgressEvent) => {
    names.push(e.type);
    loadedLength = e.loaded;
    totalLength = e.total;
    lengthComputable = e.lengthComputable;
  };

  // task1.addEventListener("loadstart", listener as EventListener);
  // task1.addEventListener("load", listener as EventListener);
  // task1.addEventListener("progress", listener as EventListener);
  // task1.addEventListener("abort", listener as EventListener);
  // task1.addEventListener("timeout", listener as EventListener);
  // task1.addEventListener("error", listener as EventListener);
  // task1.addEventListener("loadend", listener as EventListener);
  task1.onprogress = listener;

  setTimeout(() => {
    ac1.abort();
  }, 20);
  try {
    await task1.run();
    throw new Error();
  } catch (ex) {
    void ex;
  }
  //assertStrictEquals(bs1.byteLength, 8);
  assertStrictEquals(loadedLength >= 1, true);
  assertStrictEquals(totalLength, 0);
  assertStrictEquals(lengthComputable, false);
  // assertStrictEquals(names.filter((n) => n === "loadstart").length, 1);
  // assertStrictEquals(names.filter((n) => n === "load").length, 0);
  assertStrictEquals(names.filter((n) => n === "progress").length >= 1, true);
  // assertStrictEquals(names.filter((n) => n === "abort").length, 1);
  // assertStrictEquals(names.filter((n) => n === "timeout").length, 0);
  // assertStrictEquals(names.filter((n) => n === "error").length, 0);
  // assertStrictEquals(names.filter((n) => n === "loadend").length, 1);
});

//TODO "new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.onprogress - error"

Deno.test("new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.state", async () => {
  const s1 = createStream(80);
  const task1 = BytesStream.ReadingTask.create(s1);

  assertStrictEquals(task1.state, "ready");

  const tasks = [task1.run()];
  assertStrictEquals(task1.state, "running");
  const bs1 = await Promise.all(tasks);
  assertStrictEquals(bs1[0].byteLength, 80);
  assertStrictEquals(task1.state, "completed");

});

Deno.test("new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.state - abort", async () => {
  const s1 = createStream(100);
  const ac1 = new AbortController();
  const task1 = BytesStream.ReadingTask.create(s1, { signal: ac1.signal });
  try {
    setTimeout(() => {
      ac1.abort();
    }, 5);
    await task1.run();
    throw new Error();
  } catch (e) {
    const err = e as Error;
    assertStrictEquals(err.name, "AbortError");
    assertStrictEquals(task1.state, "aborted");
  }
});

//TODO "new BytesStream.ReadingTask(ReadableStream) / BytesStream.ReadingTask.prototype.state - error"
