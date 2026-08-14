import { createLanguageServer, JsonRpcMessage, LanguageServer } from "@kruton/moo-lsp";
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  DataCallback,
  Disposable,
  Message,
} from "vscode-jsonrpc/node";
import { MessageTransports } from "vscode-languageclient/node";

class InProcessMessageReader extends AbstractMessageReader {
  private callback: DataCallback | undefined;

  listen(callback: DataCallback): Disposable {
    this.callback = callback;
    return Disposable.create(() => {
      this.callback = undefined;
    });
  }

  deliver(message: Message): void {
    queueMicrotask(() => this.callback?.(message));
  }
}

class InProcessMessageWriter extends AbstractMessageWriter {
  private disposed = false;

  constructor(
    private readonly server: LanguageServer,
    private readonly reader: InProcessMessageReader,
  ) {
    super();
  }

  async write(message: Message): Promise<void> {
    if (this.disposed) {
      throw new Error("The in-process language server has been disposed");
    }

    try {
      const responses = this.server.handleMessage(message as JsonRpcMessage);
      for (const response of responses) {
        this.reader.deliver(response as Message);
      }
    } catch (error) {
      this.fireError(error, message);
      throw error;
    }
  }

  end(): void {
    this.dispose();
  }

  override dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.server.dispose();
    }
    super.dispose();
  }
}

export async function createInProcessServer(): Promise<MessageTransports> {
  const server = await createLanguageServer();
  const reader = new InProcessMessageReader();
  const writer = new InProcessMessageWriter(server, reader);
  return { reader, writer };
}
