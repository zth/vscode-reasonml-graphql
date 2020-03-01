import { ReasonRelayComponentType } from "./extensionTypes";

import { capitalize, uncapitalize, waitFor } from "./extensionUtils";

import { loadFullSchema } from "./loadSchema";

import { workspace, TextEditorEdit, commands, window, Selection } from "vscode";

import {
  GraphQLSchema,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLArgument,
  GraphQLField
} from "graphql";

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

interface QuickPickFromSchemaResult {
  schemaPromise: Promise<GraphQLSchema | null>;
  result: Thenable<string | undefined>;
}

export function quickPickFromSchema(
  placeHolder: string | undefined,
  getItems: (schema: GraphQLSchema) => string[]
): QuickPickFromSchemaResult {
  const schemaPromise = loadFullSchema(workspace.rootPath || "");

  return {
    schemaPromise,
    result: window.showQuickPick(
      schemaPromise.then((maybeSchema: GraphQLSchema | null) => {
        if (maybeSchema) {
          return getItems(maybeSchema);
        }

        return [];
      }),
      {
        placeHolder
      }
    )
  };
}

interface MakeArgsResult {
  definition: string;
  mapper: string;
}

type MakeArgsType = "ALL" | "ONLY_REQUIRED";

function makeArgs(
  type: MakeArgsType,
  field:
    | GraphQLField<
        any,
        any,
        {
          [key: string]: any;
        }
      >
    | undefined
    | null
): MakeArgsResult {
  let args = [];

  if (!field) {
    return {
      definition: "",
      mapper: ""
    };
  }

  switch (type) {
    case "ALL":
      args = field.args;
      break;
    case "ONLY_REQUIRED":
      args = field.args.filter(a => a.type.toString().endsWith("!"));
      break;
  }

  let definition = "";
  let mapper = "";

  if (args.length > 0) {
    definition += "(";
    mapper += "(";

    definition += args
      .map((v: GraphQLArgument) => `$${v.name}: ${v.type.toString()}`)
      .join(", ");

    mapper += args
      .map((v: GraphQLArgument) => `${v.name}: $${v.name}`)
      .join(", ");

    definition += ")";
    mapper += ")";
  }

  return {
    definition,
    mapper
  };
}

export async function addReasonRelayComponent(type: ReasonRelayComponentType) {
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
      const { result } = quickPickFromSchema("Select type of the fragment", s =>
        Object.values(s.getTypeMap()).reduce(
          (acc: string[], curr: GraphQLNamedType) => {
            if (curr instanceof GraphQLObjectType) {
              acc.push(curr.name);
            }

            return acc;
          },
          []
        )
      );

      const onType = (await result) || "_";

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
      const { schemaPromise, result } = quickPickFromSchema(
        "Select root field",
        s => {
          const queryObj = s.getQueryType();
          if (queryObj) {
            return Object.keys(queryObj.getFields());
          }

          return [];
        }
      );

      const query = (await result) || "_";

      const queryField = await schemaPromise.then(schema => {
        if (schema) {
          const queryObj = schema.getQueryType();
          if (queryObj) {
            return queryObj.getFields()[query] || null;
          }
        }

        return null;
      });

      const { definition, mapper } = makeArgs("ONLY_REQUIRED", queryField);

      insert += `module ${await getValidModuleName(
        docText,
        `Query`
      )} = [%relay.query\n  {|\n  query ${moduleName}Query${definition} {\n  ${query}${mapper}  \n  }\n|}\n];`;
      break;
    }
    case "Mutation": {
      const { schemaPromise, result } = quickPickFromSchema(
        "Select mutation",
        s => {
          const mutationObj = s.getMutationType();
          if (mutationObj) {
            return Object.keys(mutationObj.getFields());
          }

          return [];
        }
      );

      const mutation = (await result) || "_";

      const mutationField = await schemaPromise.then(schema => {
        if (schema) {
          const mutationObj = schema.getMutationType();
          if (mutationObj) {
            return mutationObj.getFields()[mutation] || null;
          }
        }

        return null;
      });

      const { definition, mapper } = makeArgs("ALL", mutationField);

      insert += `module ${await getValidModuleName(
        docText,
        `${capitalize(mutation)}Mutation`
      )} = [%relay.mutation\n  {|\n  mutation ${moduleName}_${capitalize(
        mutation
      )}Mutation${definition} {\n    ${mutation}${mapper}\n  }\n|}\n];`;
      break;
    }

    case "Subscription": {
      const { schemaPromise, result } = quickPickFromSchema(
        "Select subscription",
        s => {
          const subscriptionObj = s.getSubscriptionType();
          if (subscriptionObj) {
            return Object.keys(subscriptionObj.getFields());
          }

          return [];
        }
      );

      const subscription = (await result) || "_";

      const subscriptionField = await schemaPromise.then(schema => {
        if (schema) {
          const subscriptionObj = schema.getSubscriptionType();
          if (subscriptionObj) {
            return subscriptionObj.getFields()[subscription] || null;
          }
        }

        return null;
      });

      const { definition, mapper } = makeArgs("ALL", subscriptionField);
      insert += `module ${await getValidModuleName(
        docText,
        `Subscription`
      )} = [%relay.subscription\n  {|\n  subscription ${moduleName}Subscription${definition} {\n  ${subscription}${mapper}  \n  }\n|}\n];`;
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
