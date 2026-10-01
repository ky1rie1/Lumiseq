// src/tools/develop/SetWhiteBalanceTool.ts
import { AgentExecutionContext, ITool } from '../../types/agent';
import { DevelopOperationService } from '../../develop/DevelopOperationService';
import { WhiteBalanceSettings } from '../../types/develop';

export interface SetWhiteBalanceParams {
  mode?: 'as-shot' | 'auto' | 'custom';
  temperature?: number;
  tint?: number;
}

export class SetWhiteBalanceTool implements ITool<SetWhiteBalanceParams, WhiteBalanceSettings> {
  readonly name = 'develop_set_white_balance';
  readonly category = 'develop' as const;
  readonly description = 'Adjust the white balance of the active photo by Kelvin temperature and tint or mode.';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string' as const,
        description: 'White balance mode: "as-shot", "auto", or "custom"',
        enum: ['as-shot', 'auto', 'custom'],
      },
      temperature: {
        type: 'number' as const,
        description: 'Color temperature in Kelvin (2000 to 12000), e.g. 5600 for daylight, 3200 for tungsten',
        minimum: 2000,
        maximum: 12000,
      },
      tint: {
        type: 'number' as const,
        description: 'Tint adjustment (-150 to +150, green to magenta)',
        minimum: -150,
        maximum: 150,
      },
    },
    required: [],
  };
  readonly riskLevel = 'safe' as const;

  async execute(params: SetWhiteBalanceParams, context: AgentExecutionContext): Promise<WhiteBalanceSettings> {
    const newWB: WhiteBalanceSettings = {
      mode: params.mode || 'custom',
      temperature: params.temperature,
      tint: params.tint,
    };

    const operations = new DevelopOperationService(context.documentManager, context.commandBus, context.assetManager);
    if (newWB.mode === 'auto') await operations.resolveAutoWhiteBalance(context.activeDocumentId, 'ai');
    else operations.setWhiteBalance(context.activeDocumentId, newWB, 'ai');
    return context.documentManager.getDevelopDocument(context.activeDocumentId)!.settings.whiteBalance;
  }
}
