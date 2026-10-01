// src/ai/types.ts
//! AI Creative Studio - AI Architecture & Provider Types (Phase 5)

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compatible'
  | 'local'
  | 'agent-cli'
  | 'custom-rest';

export type CompatibilityMode =
  | 'standard'
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'legacy-compatible'
  | 'custom';

export type ProviderVerificationStatus = 'IMPLEMENTED' | 'UNIT_TESTED' | 'LIVE_VERIFIED';

export interface CapabilityStatus {
  claimed: boolean;
  verified: boolean;
}

export interface ProviderCapabilities {
  text: boolean;
  vision: boolean;
  toolCalling: boolean;
  streaming: boolean;
  imageGeneration: boolean;
  segmentation?: boolean;
  imageEditing?: boolean;
  structuredOutput: boolean;
  detailed?: {
    text: CapabilityStatus;
    vision: CapabilityStatus;
    toolCalling: CapabilityStatus;
    streaming: CapabilityStatus;
    imageGeneration: CapabilityStatus;
    segmentation?: CapabilityStatus;
    imageEditing?: CapabilityStatus;
    structuredOutput: CapabilityStatus;
  };
}

export interface ImageEditConfig {
  style: 'openai-edits' | 'generic-rest' | 'custom';
  imageEditModel?: string;
  endpoint?: string;
  maxDimension?: number;
  supportsMask?: boolean;
  supportsInpainting?: boolean;
  supportsOutpainting?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  /** Installed, signed-in desktop client used by the built-in chat. */
  localAgent?: 'codex' | 'claude' | 'antigravity';
  baseUrl: string;
  model: string;                // Free-text model string, allowing arbitrary router/custom model IDs
  visionModel?: string;          // Optional model override for vision tasks
  enabled: boolean;
  isDefault: boolean;
  compatibilityMode?: CompatibilityMode;
  timeoutMs?: number;
  maxRetries?: number;
  capabilities?: ProviderCapabilities;
  imageEditConfig?: ImageEditConfig;
  verificationStatus?: ProviderVerificationStatus;
  /** Optional negotiated lower limits; transport safety ceilings still apply. */
  imageLimits?: Partial<ImageInputLimits>;
}

export interface ImageInput { mimeType: string; data: string; observationId?: string }
export interface ImageInputLimits { maxImages: number; maxImageBytes: number; maxTotalBytes: number }

export type PermissionLevel = 'ask' | 'auto' | 'full' | 'readonly';

export type ToolRiskLevel = 'safe' | 'normal' | 'dangerous';

export type PrivacyMode = 'allow' | 'ask' | 'never';

export interface CostGuardConfig {
  askBeforeImageGeneration: boolean;
  askBeforeBatch: boolean;
  confirmAboveMegapixels: number;
  maxBatchPhotos: number;
}

export interface AIStackConfig {
  agentProviderId: string;
  agentFallbackId?: string;
  visionProviderId: string;
  visionFallbackId?: string;
  segmentationProviderId: string;
  imageEditProviderId: string;
}

export interface ExternalAgentConfig {
  enabled: boolean;
  port: number;
  bindAddress: string;          // Defaults strictly to 127.0.0.1
  authToken: string;
  permissionMode: PermissionLevel;
  transport: 'stdio' | 'streamable-http';
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: (string | number)[];
  default?: any;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface CanonicalToolSchema {
  name: string;
  description: string;
  workspace: 'develop' | 'edit' | 'any';
  category: 'read' | 'develop' | 'edit' | 'system';
  riskLevel: ToolRiskLevel;
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
  };
}

export type ToolErrorCode =
  | 'LAYER_LOCKED'
  | 'INVALID_ARGUMENT'
  | 'NO_DOCUMENT'
  | 'WRONG_WORKSPACE'
  | 'ASSET_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'COMMAND_FAILED'
  | 'SOURCE_UNAVAILABLE'
  | 'SEGMENTATION_UNAVAILABLE'
  | 'STALE_SOURCE'
  | 'UNSUPPORTED_OPERATION'
  | 'NO_SELECTION'
  | 'NO_LAYER'
  | 'PRIVACY_RESTRICTION'
  | 'COST_GUARD_BLOCKED';

export interface ToolResult {
  success: boolean;
  toolCallId: string;
  commandId?: string;
  changedDocumentId?: string;
  before?: any;
  after?: any;
  data?: any;
  /** Transient protocol image content; must not be saved in action history. */
  images?: ImageInput[];
  warning?: string;
  renderRequired: boolean;
  error?: {
    code: ToolErrorCode;
    message: string;
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
  /** Opaque Gemini signature; return it with a function call in the next request. */
  thoughtSignature?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  /** Image bytes stay in memory and are serialized by each provider's own protocol. */
  image?: { mimeType: string; data: string };
  images?: ImageInput[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  name?: string;
}

export interface AgentActionLogEntry {
  id: string;
  runId: string;
  stepIndex: number;
  toolName: string;
  args: Record<string, any>;
  result?: ToolResult;
  timestamp: number;
  status: 'pending' | 'success' | 'failed' | 'rejected';
  providerInfo?: {
    providerId?: string;
    modelId?: string;
    capability?: 'agent' | 'vision' | 'segmentation' | 'image-edit';
  };
}

export interface AgentRun {
  runId: string;
  documentId?: string;
  providerId?: string;
  modelId?: string;
  prompt: string;
  response?: string;
  startedAt: number;
  finishedAt?: number;
  actions: AgentActionLogEntry[];
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'partial' | 'budget_exhausted' | 'awaiting_selection';
  taskKind?: import('./harness/TaskPolicy').TaskKind;
  phase?: 'observation' | 'plan' | 'tools' | 'rendered_result' | 'review';
  journal?: { phase: NonNullable<AgentRun['phase']>; fact: string; revision?: string }[];
  budget?: import('./harness/RunBudget').RunBudgetState;
  verification?: { verified: string[]; pending: string[]; observations: import('./vision/observationTypes').ObservationEvidence[]; aesthetic?: 'pass' | 'pending' };
  stopReason?: string;
  commandIds: string[];
  error?: string;
  /** Explanation when preserving later work prevents safely rolling back this run. */
  rollbackBlockedReason?: string;
  providersUsed?: Record<string, string>; // capability -> providerId
}

export interface VisionSnapshot {
  preview512?: string;  // Base64 JPEG data URL for LLM visual input
  preview1024?: string;
  selectedRegion?: string;
  selectedLayerId?: string;
  histogram?: {
    r: number[];
    g: number[];
    b: number[];
    luminance: number[];
  };
  metadata?: Record<string, any>;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  model: string;
  detail?: string;
  visionSupport: boolean;
  toolSupport: boolean;
  streamingSupport?: boolean;
  imageEditingSupport?: boolean;
  segmentationSupport?: boolean;
  error?: string;
  verifiedCapabilities?: {
    text: boolean;
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    imageEditing?: boolean;
    segmentation?: boolean;
  };
}
