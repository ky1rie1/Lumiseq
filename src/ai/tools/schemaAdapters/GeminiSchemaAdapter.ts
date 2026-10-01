// src/ai/tools/schemaAdapters/GeminiSchemaAdapter.ts
import { CanonicalToolSchema } from '../../types';

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export class GeminiSchemaAdapter {
  static adapt(schema: CanonicalToolSchema): GeminiFunctionDeclaration {
    return {
      name: schema.name,
      description: schema.description,
      parameters: {
        type: 'OBJECT',
        properties: schema.parameters.properties,
        required: schema.parameters.required,
      },
    };
  }

  static adaptAll(schemas: CanonicalToolSchema[]): GeminiFunctionDeclaration[] {
    return schemas.map((s) => this.adapt(s));
  }
}
