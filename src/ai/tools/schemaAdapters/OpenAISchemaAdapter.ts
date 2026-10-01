// src/ai/tools/schemaAdapters/OpenAISchemaAdapter.ts
import { CanonicalToolSchema } from '../../types';

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export class OpenAISchemaAdapter {
  static adapt(schema: CanonicalToolSchema): OpenAIToolDefinition {
    return {
      type: 'function',
      function: {
        name: schema.name,
        description: schema.description,
        parameters: {
          type: 'object',
          properties: schema.parameters.properties,
          required: schema.parameters.required,
        },
      },
    };
  }

  static adaptAll(schemas: CanonicalToolSchema[]): OpenAIToolDefinition[] {
    return schemas.map((s) => this.adapt(s));
  }
}
