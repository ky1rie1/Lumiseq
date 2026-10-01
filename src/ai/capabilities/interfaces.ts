// src/ai/capabilities/interfaces.ts
//! Discrete AI Capability Interfaces for AI Creative Studio (Phase 5)
//! Replaces monolithic IAIProvider with modular, composable capabilities.

import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities,
  ProviderConfig
} from '../types';
import { Rect, Point } from '../../selection/types';
import { SegmentationOptions, SegmentationResult } from '../segmentation/types';
import { InpaintingOptions } from '../inpainting/types';

/**
 * 1. Agent Capability: LLM reasoning, planning, tool-calling, and conversational streaming.
 */
export interface IAgentCapability {
  chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage>;
}

/**
 * 2. Vision Capability: Image comprehension, visual QA, object localization, and region analysis.
 */
export interface IVisionCapability {
  analyzeImage(
    image: Blob | string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string>;

  locateObject(
    image: Blob | string,
    objectDescription: string,
    signal?: AbortSignal
  ): Promise<{ bounds?: Rect; point?: Point; description?: string }>;

  describeRegion?(
    image: Blob | string,
    region: Rect,
    signal?: AbortSignal
  ): Promise<string>;

  compareBeforeAfter?(
    before: Blob | string,
    after: Blob | string,
    prompt?: string,
    signal?: AbortSignal
  ): Promise<string>;
}

/**
 * 3. Segmentation Capability: Generation of 8-bit grayscale masks for subjects, skies, or objects.
 */
export interface ISegmentationCapability {
  readonly isLocalFallback?: boolean;

  segmentSubject(
    image: ImageData | Blob,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  segmentObject(
    image: ImageData | Blob,
    promptOrPointOrBox: string | Point | Rect,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  segmentSky(
    image: ImageData | Blob,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  segmentBackground?(
    image: ImageData | Blob,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;
}

/**
 * 4. Image Editing Capability: True generative synthesis, context-aware inpainting, and object removal.
 */
export interface IImageEditCapability {
  readonly isLocalFallback?: boolean;

  inpaint(
    contextImage: Blob,
    mask: Blob,
    options?: InpaintingOptions
  ): Promise<Blob>;

  generativeFill(
    contextImage: Blob,
    mask: Blob,
    prompt: string,
    options?: InpaintingOptions
  ): Promise<Blob>;

  outpaint?(
    contextImage: Blob,
    targetBounds: Rect,
    prompt: string,
    options?: InpaintingOptions
  ): Promise<Blob>;

  removeObject?(
    contextImage: Blob,
    mask: Blob,
    options?: InpaintingOptions
  ): Promise<Blob>;
}

/**
 * Unified Provider Instance
 * A single provider (e.g. OpenAI, Claude, Gemini, Router, or MCP) can implement one or more capabilities.
 */
export interface IProviderInstance {
  readonly id: string;
  readonly name: string;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  agent?: IAgentCapability;
  vision?: IVisionCapability;
  segmentation?: ISegmentationCapability;
  imageEdit?: IImageEditCapability;

  testConnection(): Promise<ConnectionTestResult>;
}
