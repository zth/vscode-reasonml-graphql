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
  Selection
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient";

import {
  prettify,
  restoreOperationPadding,
  capitalize,
  waitFor,
  uncapitalize
} from "./extensionUtils";
import { extractGraphQLSources } from "./findGraphQLSources";

import { GraphQLSource, ReasonRelayComponentType } from "./extensionTypes";
import { loadFullSchema } from "./loadSchema";
import { GraphQLNamedType, GraphQLSchema, GraphQLObjectType } from "graphql";

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

async function getValidModuleName(
  docText: string,
  name: string
): Promise<string> {
  const newName = docText.includes(`module ${name} =`)
    ? await window.showInputBox({
        prompt: "Enter module name ('" + name + "' already exists in document)",
        validateInput: (v: string) =>
          v !== name ? null : "Name cannot be '" + name + "'.",
        value: name
      })
    : null;

  return newName || name;
}

async function addReasonRelayComponent(type: ReasonRelayComponentType) {
  const textEditor = window.activeTextEditor;

  if (!textEditor) {
    window.showErrorMessage("Missing active text editor.");
    return;
  }

  const docText = textEditor.document.getText();

  let insert = "";

  const moduleName = capitalize(
    (textEditor.document.fileName.split(/\\|\//).pop() || "")
      .split(".")
      .shift() || ""
  );

  switch (type) {
    case "Fragment": {
      const onType =
        (await window.showQuickPick(
          loadFullSchema(workspace.rootPath || "").then(
            (maybeSchema: GraphQLSchema | null) => {
              if (maybeSchema) {
                return Object.values(maybeSchema.getTypeMap()).reduce(
                  (acc: string[], curr: GraphQLNamedType) => {
                    if (curr instanceof GraphQLObjectType) {
                      acc.push(curr.name);
                    }

                    return acc;
                  },
                  []
                );
              }

              return [];
            }
          ),
          {
            placeHolder: "Select what GraphQL type your fragment is on"
          }
        )) || "_";

      const rModuleName = await getValidModuleName(
        docText,
        `${onType}Fragment`
      );

      insert += `module ${rModuleName} = [%relay.fragment\n  {|\n  fragment ${moduleName}_${uncapitalize(
        rModuleName.replace("Fragment", "")
      )} on ${onType} {\n   id\n    \n  }\n|}\n];`;
      break;
    }
    case "Query": {
      insert += `module ${await getValidModuleName(
        docText,
        `Query`
      )} = [%relay.query\n  {|\n  query ${moduleName}Query {\n  __typename # Placeholder value  \n  }\n|}\n];`;
      break;
    }
    case "Mutation": {
      insert += `module ${await getValidModuleName(
        docText,
        `Mutation`
      )} = [%relay.mutation\n  {|\n  mutation ${moduleName}Mutation {\n  __typename # Placeholder value  \n  }\n|}\n];`;
      break;
    }

    case "Subscription": {
      insert += `module ${await getValidModuleName(
        docText,
        `Subscription`
      )} = [%relay.subscription\n  {|\n  subscription ${moduleName}Subscription {\n  __typename # Placeholder value  \n  }\n|}\n];`;
      break;
    }
  }

  await textEditor.edit((editBuilder: TextEditorEdit) => {
    const textDocument = textEditor.document;

    if (!textDocument) {
      return;
    }

    editBuilder.insert(textEditor.selection.active, insert);
  });

  const currentPos = textEditor.selection.active;
  const newPos = currentPos.with(currentPos.line - 3);

  textEditor.selection = new Selection(newPos, newPos);

  const textDocument = textEditor.document;

  if (!textDocument) {
    return;
  }

  await textDocument.save();

  const edited = await commands.executeCommand("vscode-graphiql-explorer.edit");

  if (edited) {
    await textDocument.save();

    // Wait to let Relay's compiler work
    await waitFor(500);
    await textDocument.save();
  }
}

function initCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand(
      "vscode-reasonml-graphql.format-document",
      formatDocument
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-fragment",
      () => addReasonRelayComponent("Fragment")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-query",
      () => addReasonRelayComponent("Query")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-mutation",
      () => addReasonRelayComponent("Mutation")
    ),
    commands.registerCommand(
      "vscode-reasonml-graphql.add-reason-relay-subscription",
      () => addReasonRelayComponent("Subscription")
    )
  );
}

function initLanguageServer(
  context: ExtensionContext,
  outputChannel: OutputChannel
): void {
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
}

export async function activate(context: ExtensionContext) {
  let outputChannel: OutputChannel = window.createOutputChannel(
    "GraphQL Language Server"
  );

  initLanguageServer(context, outputChannel);
  initCommands(context);
}

export function deactivate() {
  console.log('Extension "vscode-reasonml-graphql" is now de-activated!');
}
