import { RawSchema } from "./extensionTypes";
import { loaders } from "./schemaLoaders";
import * as fs from "fs";
import {
  GraphQLSchema,
  buildClientSchema,
  IntrospectionQuery,
  buildSchema
} from "graphql";

function parseSchema(schema: RawSchema): GraphQLSchema {
  let processed: GraphQLSchema;

  if (schema.type === "json") {
    let parsed = JSON.parse(schema.content);

    if (parsed.data) {
      parsed = parsed.data;
    }

    processed = buildClientSchema(parsed as IntrospectionQuery);
  } else {
    processed = buildSchema(schema.content);
  }

  return processed;
}

export async function loadRawSchema(
  rootPath: string
): Promise<RawSchema | null> {
  const filesInRoot = fs.readdirSync(rootPath);

  let rawSchema: RawSchema | null = null;

  for (let i = 0; i <= loaders.length - 1; i += 1) {
    let loaderResult = await loaders[i](rootPath, filesInRoot);

    if (loaderResult) {
      rawSchema = loaderResult;
      break;
    }
  }

  return rawSchema || null;
}

export async function loadFullSchema(
  rootPath: string
): Promise<GraphQLSchema | null> {
  const rawSchema = await loadRawSchema(rootPath);

  if (!rawSchema) {
    return null;
  }

  return parseSchema(rawSchema);
}
