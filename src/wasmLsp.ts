// Portions derived from @vscode/wasm-wasi-lsp.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.

import {
  Readable,
  Stdio,
  WasmProcess,
  Writable,
} from "@vscode/wasm-wasi/v1";
import {
  Disposable,
  Emitter,
  Event,
  Message,
  MessageTransports,
  RAL,
  ReadableStreamMessageReader,
  WriteableStreamMessageWriter,
} from "vscode-languageclient/browser";

class ReadableStream implements RAL.ReadableStream {
  private readonly errorEmitter = new Emitter<[Error, Message | undefined, number | undefined]>();
  private readonly closeEmitter = new Emitter<void>();
  private readonly endEmitter = new Emitter<void>();

  public constructor(private readonly readable: Readable) {}

  public get onData(): Event<Uint8Array> {
    return this.readable.onData;
  }

  public get onError(): Event<[Error, Message | undefined, number | undefined]> {
    return this.errorEmitter.event;
  }

  public get onClose(): Event<void> {
    return this.closeEmitter.event;
  }

  public onEnd(listener: () => void): Disposable {
    return this.endEmitter.event(listener);
  }

  public end(): void {
    this.endEmitter.fire();
  }

  public fail(error: Error): void {
    this.errorEmitter.fire([error, undefined, undefined]);
  }
}

class WritableStream implements RAL.WritableStream {
  private readonly errorEmitter = new Emitter<[Error, Message | undefined, number | undefined]>();
  private readonly closeEmitter = new Emitter<void>();
  private readonly endEmitter = new Emitter<void>();

  public constructor(private readonly writable: Writable) {}

  public get onError(): Event<[Error, Message | undefined, number | undefined]> {
    return this.errorEmitter.event;
  }

  public get onClose(): Event<void> {
    return this.closeEmitter.event;
  }

  public onEnd(listener: () => void): Disposable {
    return this.endEmitter.event(listener);
  }

  public write(data: string | Uint8Array): Promise<void> {
    return typeof data === "string"
      ? this.writable.write(data, "utf-8")
      : this.writable.write(data);
  }

  public end(): void {
    this.endEmitter.fire();
  }
}

export function createStdioOptions(): Stdio {
  return {
    in: { kind: "pipeIn" },
    out: { kind: "pipeOut" },
    err: { kind: "pipeOut" },
  };
}

export async function startServer(process: WasmProcess): Promise<MessageTransports> {
  if (!process.stdout || !process.stdin) {
    throw new Error("The WebAssembly server was created without stdio pipes.");
  }

  const readable = new ReadableStream(process.stdout);
  const writable = new WritableStream(process.stdin);
  void process.run().then(
    (code) => code === 0
      ? readable.end()
      : readable.fail(new Error(`WebAssembly server exited with code ${code}.`)),
    (error: unknown) => readable.fail(error instanceof Error ? error : new Error(String(error))),
  );

  return {
    reader: new ReadableStreamMessageReader(readable),
    writer: new WriteableStreamMessageWriter(writable),
    detached: false,
  };
}
