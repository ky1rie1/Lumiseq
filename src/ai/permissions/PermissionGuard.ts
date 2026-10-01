// src/ai/permissions/PermissionGuard.ts
import { PermissionLevel, ToolRiskLevel } from '../types';
import { CanonicalTool } from '../tools/CanonicalTool';

export type ConfirmationCallback = (tool: CanonicalTool, args: Record<string, any>) => Promise<boolean>;

export type PermissionDecision = 'allow' | 'deny' | 'confirm';

/** Pure policy shared by internal runs and external clients, each with its own level. */
export function evaluatePermissionPolicy(level: PermissionLevel, risk: ToolRiskLevel): PermissionDecision {
  if (!['readonly', 'ask', 'auto', 'full'].includes(level)) return 'deny';
  if (risk === 'safe') return 'allow';
  if (level === 'readonly') return 'deny';
  if (risk === 'dangerous') return 'confirm';
  if (risk !== 'normal') return 'deny';
  return level === 'ask' ? 'confirm' : 'allow';
}

export class PermissionGuard {
  private level: PermissionLevel = 'auto';
  private confirmationHandler: ConfirmationCallback | null = null;

  setLevel(level: PermissionLevel): void {
    this.level = level;
  }

  getLevel(): PermissionLevel {
    return this.level;
  }

  setConfirmationHandler(handler: ConfirmationCallback | null): void {
    this.confirmationHandler = handler;
  }

  /**
   * Evaluates whether a tool execution requires user prompt / confirmation.
   * Returns true if allowed, false if rejected.
   */
  async checkPermission(tool: CanonicalTool, args: Record<string, any>, level: PermissionLevel = this.level): Promise<boolean> {
    const decision = evaluatePermissionPolicy(level, tool.schema.riskLevel);
    if (decision === 'deny') return false;
    if (decision === 'allow') return true;
    return this.confirmationHandler ? await this.confirmationHandler(tool, args) : false;
  }
}

export const defaultPermissionGuard = new PermissionGuard();
