import * as path from "path";
import {
  workspace,
  ExtensionContext,
  window,
  OutputChannel,
  commands,
  TextEditorEdit,
  Range,
  Position,
  languages,
  CompletionItem,
  Hover,
  MarkdownString
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  CompletionItemKind,
  HoverRequest
} from "vscode-languageclient";

import { prettify, restoreOperationPadding } from "./extensionUtils";
import { extractGraphQLSources } from "./findGraphQLSources";

import { GraphQLSource } from "./extensionTypes";

import { addGraphQLComponent } from "./addGraphQLComponent";

function formatDocument() {
  const textEditor = window.activeTextEditor;

  if (!textEditor) {
    window.showErrorMessage("Missing active text editor.");
    return;
  }

  const sources = extractGraphQLSources(
    textEditor.document.languageId,
    textEditor.document.getText()
  );

  textEditor.edit((editBuilder: TextEditorEdit) => {
    const textDocument = textEditor.document;

    if (!textDocument) {
      return;
    }

    if (sources) {
      sources.forEach((source: GraphQLSource) => {
        if (source.type === "TAG" && /^[\s]+$/g.test(source.content)) {
          window.showInformationMessage("Cannot format an empty code block.");
          return;
        }
        try {
          const newContent = restoreOperationPadding(
            prettify(source.content),
            source.content
          );

          if (source.type === "TAG") {
            editBuilder.replace(
              new Range(
                new Position(source.start.line, source.start.character),
                new Position(source.end.line, source.end.character)
              ),
              newContent
            );
          } else if (source.type === "FULL_DOCUMENT" && textDocument) {
            editBuilder.replace(
              new Range(
                new Position(0, 0),
                new Position(textDocument.lineCount + 1, 0)
              ),
              newContent
            );
          }
        } catch {
          // Silent
        }
      });
    }
  });
}

function initHoverProviders(client: LanguageClient) {
  languages.registerHoverProvider("reason", {
    async provideHover(document, position, token) {
      const stuff = await client
        .sendRequest(
          HoverRequest.type,
          client.code2ProtocolConverter.asTextDocumentPositionParams(
            document,
            position
          ),
          token
        )
        .then(client.protocol2CodeConverter.asHover, error => {
          client.logFailedRequest(HoverRequest.type, error);
          return Promise.resolve(null);
        });

      return {
        contents: [stuff]
      };
    }
  });

  languages.registerCompletionItemProvider(
    "reason",
    {
      // @ts-ignore
      async provideCompletionItems(document, pos, token, context) {
        const matchingFields = ["someField"];

        const hoverResult: Hover[] | undefined = await commands.executeCommand(
          "vscode.executeHoverProvider",
          document.uri,
          new Position(pos.line, pos.character - 1)
        );

        if (hoverResult) {
          // Handle fragments
          let reasonRelayTypeDefinition: string | null = null;

          for (let i = 0; i <= hoverResult.length - 1; i += 1) {
            const currentHover = hoverResult[0];
            const def = currentHover.contents.find(c => {
              const value = (c as MarkdownString).value;

              window.showInformationMessage(value);
              window.showInformationMessage(value.split("\n")[0]);

              return value.split("\n")[0].includes(".Operation.");
            });

            if (def) {
              reasonRelayTypeDefinition = (def as MarkdownString).value;
              break;
            }
          }

          if (reasonRelayTypeDefinition) {
            window.showInformationMessage(reasonRelayTypeDefinition);
          }

          return matchingFields.reduce(
            (acc: CompletionItem[], curr: string) => {
              const item = new CompletionItem(
                `GraphQL: Add '${curr}' to selection`
              );

              item.insertText = curr;
              item.kind = CompletionItemKind.Field;
              item.sortText = "zzzzzzz";
              acc.push(item);

              return acc;
            },
            []
          );
        }

        return [];
      }
    },
    "."
  );
}

function initCommands(context: ExtensionContext, _: LanguageClient): void {
  context.subscriptions.push(
    commands.registerCommand(
      "vscode-reasonml-graphql.format-document",
      formatDocument
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-fragment",
      () => addGraphQLComponent("ReasonRelay", "Fragment")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-query",
      () => addGraphQLComponent("ReasonRelay", "Query")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-mutation",
      () => addGraphQLComponent("ReasonRelay", "Mutation")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-subscription",
      () => addGraphQLComponent("ReasonRelay", "Subscription")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-graphqlppx-fragment",
      () => addGraphQLComponent("graphql_ppx", "Fragment")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-graphqlppx-query",
      () => addGraphQLComponent("graphql_ppx", "Query")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-graphqlppx-mutation",
      () => addGraphQLComponent("graphql_ppx", "Mutation")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-graphqlppx-subscription",
      () => addGraphQLComponent("graphql_ppx", "Subscription")
    )
  );
}

function initLanguageServer(
  context: ExtensionContext,
  outputChannel: OutputChannel
): LanguageClient {
  const serverModule = context.asAbsolutePath(path.join("build", "server.js"));

  /*
  const debugOptions = {
    execArgv: ["--nolazy", "--debug=6009", "--inspect=localhost:6009"]
  };
  */

  let serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc
    }
  };

  let clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "graphql" },
      { scheme: "file", language: "reason" }
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{graphql,gql,re}")
    },
    outputChannel: outputChannel,
    outputChannelName: "GraphQL Language Server"
  };

  const client = new LanguageClient(
    "vscode-reasonml-graphql",
    "GraphQL Language Server",
    serverOptions,
    clientOptions
  );

  const disposableClient = client.start();
  context.subscriptions.push(disposableClient);

  return client;
}

export async function activate(context: ExtensionContext) {
  const outputChannel: OutputChannel = window.createOutputChannel(
    "GraphQL Language Server"
  );

  const client = initLanguageServer(context, outputChannel);
  initCommands(context, client);
  initHoverProviders(client);
}

export function deactivate() {
  console.log('Extension "vscode-reasonml-graphql" is now de-activated!');
}
