// src/tools/edit/SetLayerOpacityTool.ts
import { AgentExecutionContext, ITool } from '../../types/agent';
import { SetLayerOpacityCommand } from '../../commands/edit/SetLayerOpacityCommand';

export interface SetLayerOpacityParams {
  layerId: string;
  opacity: number;
}

export class SetLayerOpacityTool implements ITool<SetLayerOpacityParams, { layerId: string; opacity: number }> {
  readonly name = 'edit_set_layer_opacity';
  readonly category = 'edit' as const;
  readonly description = 'Set the opacity of a specific layer in the Edit workspace document (0.0 to 1.0).';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      layerId: {
        type: 'string' as const,
        description: 'Target layer identifier',
      },
      opacity: {
        type: 'number' as const,
        description: 'Opacity value from 0.0 (completely transparent) to 1.0 (completely opaque)',
        minimum: 0.0,
        maximum: 1.0,
      },
    },
    required: ['layerId', 'opacity'],
  };
  readonly riskLevel = 'safe' as const;

  async execute(params: SetLayerOpacityParams, context: AgentExecutionContext): Promise<{ layerId: string; opacity: number }> {
    const command = new SetLayerOpacityCommand(
      context.activeDocumentId,
      params.layerId,
      params.opacity,
      context.documentManager
    );

    context.commandBus.execute(command);
    return { layerId: params.layerId, opacity: params.opacity };
  }
}
