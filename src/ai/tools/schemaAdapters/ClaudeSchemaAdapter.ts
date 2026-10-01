// src/ai/tools/schemaAdapters/ClaudeSchemaAdapter.ts
import { CanonicalToolSchema } from '../../types';

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export class ClaudeSchemaAdapter {
  static adapt(schema: CanonicalToolSchema): ClaudeToolDefinition {
    return {
      name: schema.name,
      description: schema.description,
      input_schema: {
        type: 'object',
        properties: schema.parameters.properties,
        required: schema.parameters.required,
      },
    };
  }

  static adaptAll(schemas: CanonicalToolSchema[]): ClaudeToolDefinition[] {
    return schemas.map((s) => this.adapt(s));
  }
}
