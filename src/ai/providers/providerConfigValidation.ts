import type { ProviderConfig } from '../types';

export function validateProviderSettings(config: ProviderConfig): string | null {
  if (!config.name.trim()) return '请填写服务名称。';
  if (config.type === 'agent-cli') {
    return ['codex', 'claude', 'antigravity'].includes(config.localAgent ?? '') ? null : '请选择受支持的本机 Agent。';
  }
  if (!config.model.trim()) return '请填写模型 ID。';
  if (!['openai', 'anthropic', 'gemini', 'openai-compatible', 'local'].includes(config.type)) {
    return '此 API 协议暂不支持对话；请选择 OpenAI 兼容、Claude 或 Gemini。';
  }
  let url: URL;
  try { url = new URL(config.baseUrl); }
  catch { return '请填写有效的服务基础地址。'; }
  if (url.username || url.password || url.search || url.hash) return '服务基础地址不能包含凭据、查询参数或片段。';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    return '远程服务请使用 HTTPS 地址。';
  }
  if (/\/(?:chat\/completions|messages|models\/[^/]+:generateContent)\/?$/i.test(url.pathname)) {
    return '请填写服务基础地址，不要包含具体接口路径。';
  }
  return null;
}
