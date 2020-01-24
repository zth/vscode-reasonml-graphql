# vscode-reasonml-graphql

Tighter integration between ReasonML and GraphQL in VSCode.

## Features

Supports both `graphql_ppx` and `ReasonRelay`.

- Syntax highlighting for GraphQL in ReasonML.
- Autocomplete and validations for your GraphQL operations using the official GraphQL Language Server.
- Format all GraphQL operations in your Reason file using `prettier`.

## Setup

`vscode-reasonml-graphql` needs your introspected schema, either as a `.json` or a `.graphql` file, through a file called `.graphqlconfig` in your project root.

Make sure you have a `.graphqlconfig` file in your project root containing a `schemaPath` pointing to your schema, like `{ "schemaPath": "/path/to/schema.graphql" }`.

If you don't already have a introspection schema file you can create one by running `npx get-graphql-schema http://url/to/your/graphql/endpoint > schema.graphql` in your project root.

## Usage

In addition to providing integration with the official GraphQL language server, the extension currently add 1 command:

1. `Format GraphQL operations in document`, which will format all GraphQL operations defined in the current document.

## WIP/Coming soon

- Specific GraphQL validation rules for `graphql_ppx` and `ReasonRelay` for the language server integration. Read: Validations will include custom directives defined by each framework, and for `ReasonRelay` validation will be provided for most (if not all) special Relay rules in GraphQL.
- Commands/snippets for inserting new operations into document.
- Figure out bundling to reduce size.

## Background, vision and contributing

Let's work together to provide the best possible experience we can for using GraphQL with ReasonML. Please post any ideas or thoughts, large or small, in the issues and let's get some great discussions for features going!
