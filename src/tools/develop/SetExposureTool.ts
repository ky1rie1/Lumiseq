// src/tools/develop/SetExposureTool.ts
import { AgentExecutionContext, ITool } from '../../types/agent';
import { SetExposureCommand } from '../../commands/develop/SetExposureCommand';

export interface SetExposureParams {
  exposure: number;
}

export class SetExposureTool implements ITool<SetExposureParams, { exposure: number }> {
  readonly name = 'develop_set_exposure';
  readonly category = 'develop' as const;
  readonly description = 'Adjust the overall exposure of the currently active Develop photo in EV (-5.0 to +5.0).';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      exposure: {
        type: 'number' as const,
        description: 'Exposure value in EV (e.g. 0.5 for +0.5 EV, -0.7 for -0.7 EV)',
        minimum: -5.0,
        maximum: 5.0,
      },
    },
    required: ['exposure'],
  };
  readonly riskLevel = 'safe' as const;

  async execute(params: SetExposureParams, context: AgentExecutionContext): Promise<{ exposure: number }> {
    // Rule 9: Tool NEVER modifies state directly.
    // It creates and dispatches ICommand through context.commandBus.
    const command = new SetExposureCommand(
      context.activeDocumentId,
      params.exposure,
      context.documentManager
    );

    context.commandBus.execute(command);
    return { exposure: params.exposure };
  }
}
