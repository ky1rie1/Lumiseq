// src/ai/tools/CanonicalTool.ts
import { CanonicalToolSchema, ToolResult } from '../types';
import { DocumentManager } from '../../document/DocumentManager';
import { ICommandBus } from '../../types/history';
import { VisionSnapshot } from '../types';
import type { DevelopSettingsClipboard } from '../../develop/DevelopSettingsClipboard';
import type { DocumentObservationService } from '../vision/DocumentObservationService';
import type { CandidateService, CandidateExecution } from '../harness/CandidateService';
import type { TastePreferences } from '../harness/TastePreferences';

export interface IToolContext {
  /** Current runtime/request cancellation; optional for existing external callers. */
  signal?:AbortSignal;
  documentManager: DocumentManager;
  commandBus: ICommandBus;
  currentWorkspace: 'develop' | 'edit';
  visionSnapshot?: VisionSnapshot;
  observationService?: DocumentObservationService;
  developSettingsClipboard?: DevelopSettingsClipboard;
  candidateService?: CandidateService;
  candidateExecution?: CandidateExecution;
  tastePreferences?: TastePreferences;
  /** Set only after a real PermissionGuard user confirmation, never from model arguments. */
  userApproved?: boolean;
  candidateChoice?: (candidateId: string) => Promise<unknown>;
}

export abstract class CanonicalTool {
  abstract readonly schema: CanonicalToolSchema;

  /**
   * Safe execution of the tool via the CommandBus.
   * All mutations MUST generate a Command and execute via commandBus.
   */
  abstract execute(
    context: IToolContext,
    args: Record<string, any>,
    toolCallId: string
  ): Promise<ToolResult>;
}
