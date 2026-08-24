import { z } from "zod";
import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin/server";

export const repositoryContextSearch = defineRpc({
  name: "repository-context.search",
  input: z.object({ query: z.string().default(""), workspaceId: z.string().optional(), repositoryPath: z.string().optional() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const repositoryContextSource = defineAttachmentSource({
  id: "repository-context",
  title: "Repository context",
  icon: "FileSearch",
  pickerTitle: "Add repository context",
  searchPlaceholder: "Search files by path or title",
  search: repositoryContextSearch,
});
