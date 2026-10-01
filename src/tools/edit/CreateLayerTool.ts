// src/tools/edit/CreateLayerTool.ts
import { AgentExecutionContext, ITool } from '../../types/agent';
import { createTextLayer } from '../../document/EditDocument';
import { CreateLayerCommand } from '../../commands/edit/CreateLayerCommand';

export interface CreateTextLayerParams {
  text: string;
  name?: string;
  fontSize?: number;
  color?: string;
  x?: number;
  y?: number;
}

export class CreateTextLayerTool implements ITool<CreateTextLayerParams, { layerId: string }> {
  readonly name = 'edit_create_text_layer';
  readonly category = 'edit' as const;
  readonly description = 'Create a new typography / text layer in the active Edit workspace document.';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description: 'Text string content to display on the canvas (e.g. "Tokyo Night")',
      },
      name: {
        type: 'string' as const,
        description: 'Optional layer name in the layers list',
      },
      fontSize: {
        type: 'number' as const,
        description: 'Font size in pixels (default 48)',
      },
      color: {
        type: 'string' as const,
        description: 'Hex color string (e.g. "#ffffff")',
      },
      x: {
        type: 'number' as const,
        description: 'X coordinate on canvas',
      },
      y: {
        type: 'number' as const,
        description: 'Y coordinate on canvas',
      },
    },
    required: ['text'],
  };
  readonly riskLevel = 'normal' as const;

  async execute(params: CreateTextLayerParams, context: AgentExecutionContext): Promise<{ layerId: string }> {
    const layer = createTextLayer({
      text: params.text,
      name: params.name,
      fontSize: params.fontSize,
      color: params.color,
      x: params.x,
      y: params.y,
    });

    const command = new CreateLayerCommand(
      context.activeDocumentId,
      layer,
      context.documentManager
    );

    context.commandBus.execute(command);
    return { layerId: layer.id };
  }
}
