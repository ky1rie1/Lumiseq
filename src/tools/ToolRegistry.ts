// src/tools/ToolRegistry.ts
import { ITool } from '../types/agent';
import { SetExposureTool } from './develop/SetExposureTool';
import { SetWhiteBalanceTool } from './develop/SetWhiteBalanceTool';
import { CreateTextLayerTool } from './edit/CreateLayerTool';
import { SetLayerOpacityTool } from './edit/SetLayerOpacityTool';

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  listTools(category?: 'develop' | 'edit' | 'catalog' | 'system'): ITool[] {
    const all = Array.from(this.tools.values());
    if (!category) return all;
    return all.filter(t => t.category === category);
  }

  /**
   * Export all tools as standard JSON Schema for OpenAI / Anthropic / Gemini Function Calling
   */
  exportFunctionSchemas(): Array<{
    name: string;
    description: string;
    parameters: ITool['parameters'];
  }> {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}

export const defaultToolRegistry = new ToolRegistry();
// Register default phase 1 tools
defaultToolRegistry.register(new SetExposureTool());
defaultToolRegistry.register(new SetWhiteBalanceTool());
defaultToolRegistry.register(new CreateTextLayerTool());
defaultToolRegistry.register(new SetLayerOpacityTool());
