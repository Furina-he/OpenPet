import { z } from 'zod';
import { AdapterSchema, CapabilitySchema, type Capability } from './provider-config.js';
import { ConfigItemMetaSchema, type ConfigItemMeta } from './config-metadata.js';

/**
 * 具名 provider 模板注册表 —— **严格照搬 AstrBot `config_template`**
 *（`astrbot/core/config/default.py` 的 `provider.config_template`）。
 *
 * AstrBot「新增提供商」交互 = 能力 tab + 具名 provider 卡片网格（图标 + 名 + 简介）。
 * 本表是那张卡片网格的数据源（`AddSourceDialog` 按 capability 过滤渲染）。
 *
 * openpet 两层 Source+Model 适配：
 * - `adapter` = worker 实际 wire 格式（openai/anthropic/gemini/ollama）；AstrBot `type` 经映射得到。
 *   多数 *_chat_completion / openai 兼容端点 → openai；anthropic/*_token_plan(/anthropic) → anthropic；
 *   googlegenai → gemini；openpet 原生 ollama 保留 ollama。
 * - `provider` = 厂商/图标键（= AstrBot `provider`，喂 providerIconUrl）。
 * - `id` = 源 id 基（= AstrBot `id`，generateUniqueSourceId 用）。
 * - embedding 仅用 openai/ollama 格式（worker `embed()` 实现的两格式；Gemini/NVIDIA 走各自的
 *   openai 兼容端点，故仍是 openai 格式、真可用）。stt/tts/rerank/agent_runner 暂「存而不接」。
 */
export const ProviderTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  capability: CapabilitySchema,
  adapter: AdapterSchema,
  apiBase: z.string(),
  defaultModels: z.array(z.string()).default([]),
});
export type ProviderTemplate = z.infer<typeof ProviderTemplateSchema>;

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ---- chat_completion ----
  {
    id: 'openai',
    name: 'OpenAI Compatible',
    provider: 'openai',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModels: [],
  },
  {
    id: 'google_gemini',
    name: 'Google Gemini',
    provider: 'google',
    capability: 'chat',
    adapter: 'gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModels: [],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    provider: 'anthropic',
    capability: 'chat',
    adapter: 'anthropic',
    apiBase: 'https://api.anthropic.com/v1',
    defaultModels: [],
  },
  {
    id: 'kimi-code',
    name: 'Kimi Coding Plan',
    provider: 'kimi-code',
    capability: 'chat',
    adapter: 'anthropic',
    apiBase: 'https://api.kimi.com/coding',
    defaultModels: [],
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    provider: 'moonshot',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.moonshot.cn/v1',
    defaultModels: [],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    provider: 'minimax',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.minimaxi.com/v1',
    defaultModels: [],
  },
  {
    id: 'minimax-token-plan',
    name: 'MiniMax Token Plan',
    provider: 'minimax-token-plan',
    capability: 'chat',
    adapter: 'anthropic',
    apiBase: 'https://api.minimaxi.com/anthropic',
    defaultModels: [],
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi',
    provider: 'xiaomi',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.xiaomimimo.com/v1',
    defaultModels: [],
  },
  {
    id: 'xiaomi-token-plan',
    name: 'Xiaomi Token Plan',
    provider: 'xiaomi-token-plan',
    capability: 'chat',
    adapter: 'anthropic',
    apiBase: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    defaultModels: [],
  },
  {
    id: 'xai',
    name: 'xAI',
    provider: 'xai',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.x.ai/v1',
    defaultModels: [],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.deepseek.com/v1',
    defaultModels: [],
  },
  {
    id: 'zhipu',
    name: 'Zhipu',
    provider: 'zhipu',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModels: [],
  },
  {
    id: 'longcat',
    name: 'LongCat',
    provider: 'longcat',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.longcat.chat/openai',
    defaultModels: [],
  },
  {
    id: 'aihubmix',
    name: 'AIHubMix',
    provider: 'aihubmix',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://aihubmix.com/v1',
    defaultModels: [],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openrouter',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://openrouter.ai/api/v1',
    defaultModels: [],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    provider: 'nvidia',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://integrate.api.nvidia.com/v1',
    defaultModels: [],
  },
  {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    provider: 'azure',
    capability: 'chat',
    adapter: 'openai',
    apiBase: '',
    defaultModels: [],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    provider: 'ollama',
    capability: 'chat',
    adapter: 'ollama',
    apiBase: 'http://127.0.0.1:11434',
    defaultModels: [],
  },
  {
    id: 'lm_studio',
    name: 'LM Studio',
    provider: 'lm_studio',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:1234/v1',
    defaultModels: [],
  },
  {
    id: 'google_gemini_openai',
    name: 'Gemini (OpenAI 兼容)',
    provider: 'google',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModels: [],
  },
  {
    id: 'groq',
    name: 'Groq',
    provider: 'groq',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.groq.com/openai/v1',
    defaultModels: [],
  },
  {
    id: '302ai',
    name: '302.AI',
    provider: '302ai',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.302.ai/v1',
    defaultModels: [],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    provider: 'siliconflow',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.siliconflow.cn/v1',
    defaultModels: [],
  },
  {
    id: 'ppio',
    name: 'PPIO',
    provider: 'ppio',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.ppinfra.com/v3/openai',
    defaultModels: [],
  },
  {
    id: 'tokenpony',
    name: 'TokenPony',
    provider: 'tokenpony',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.tokenpony.cn/v1',
    defaultModels: [],
  },
  {
    id: 'compshare',
    name: 'Compshare',
    provider: 'compshare',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.modelverse.cn/v1',
    defaultModels: [],
  },
  {
    id: 'modelscope',
    name: 'ModelScope',
    provider: 'modelscope',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api-inference.modelscope.cn/v1',
    defaultModels: [],
  },
  {
    id: 'fastgpt',
    name: 'FastGPT',
    provider: 'fastgpt',
    capability: 'chat',
    adapter: 'openai',
    apiBase: 'https://api.fastgpt.in/api/v1',
    defaultModels: [],
  },

  // ---- agent_runner（openpet 暂无 runtime；adapter=openai 占位） ----
  {
    id: 'dify_app_default',
    name: 'Dify',
    provider: 'dify',
    capability: 'agent_runner',
    adapter: 'openai',
    apiBase: 'https://api.dify.ai/v1',
    defaultModels: [],
  },
  {
    id: 'coze',
    name: 'Coze',
    provider: 'coze',
    capability: 'agent_runner',
    adapter: 'openai',
    apiBase: 'https://api.coze.cn',
    defaultModels: [],
  },
  {
    id: 'dashscope',
    name: '阿里云百炼应用',
    provider: 'dashscope',
    capability: 'agent_runner',
    adapter: 'openai',
    apiBase: '',
    defaultModels: [],
  },
  {
    id: 'deerflow',
    name: 'DeerFlow',
    provider: 'deerflow',
    capability: 'agent_runner',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:2026',
    defaultModels: [],
  },

  // ---- speech_to_text ----
  {
    id: 'whisper',
    name: 'Whisper(API)',
    provider: 'openai',
    capability: 'stt',
    adapter: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModels: ['whisper-1'],
  },
  {
    id: 'mimo_stt',
    name: 'MiMo STT(API)',
    provider: 'mimo',
    capability: 'stt',
    adapter: 'openai',
    apiBase: 'https://api.xiaomimimo.com/v1',
    // MiMo-V2 系列 2026-06-30 下线；v2.5-asr 为现役语音识别专用模型（AstrBot c9eed7b）。
    defaultModels: ['mimo-v2.5-asr'],
  },
  {
    id: 'whisper_selfhost',
    name: 'Whisper(Local)',
    provider: 'openai',
    capability: 'stt',
    adapter: 'openai',
    apiBase: '',
    defaultModels: ['tiny'],
  },
  {
    id: 'sensevoice',
    name: 'SenseVoice(Local)',
    provider: 'sensevoice',
    capability: 'stt',
    adapter: 'openai',
    apiBase: '',
    defaultModels: ['iic/SenseVoiceSmall'],
  },
  {
    id: 'xinference_stt',
    name: 'Xinference STT',
    provider: 'xinference',
    capability: 'stt',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:9997',
    defaultModels: ['whisper-large-v3'],
  },

  // ---- text_to_speech ----
  {
    id: 'openai_tts',
    name: 'OpenAI TTS(API)',
    provider: 'openai',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModels: ['tts-1', 'tts-1-hd'],
  },
  {
    id: 'mimo_tts',
    name: 'MiMo TTS(API)',
    provider: 'mimo',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://api.xiaomimimo.com/v1',
    // 上游默认仍是 mimo-v2-tts，但 V2 系列 2026-06-30 已下线 → 用现役 v2.5（真窗实测可用）。
    defaultModels: ['mimo-v2.5-tts'],
  },
  {
    id: 'genie_tts',
    name: 'Genie TTS',
    provider: 'genie_tts',
    capability: 'tts',
    adapter: 'openai',
    apiBase: '',
    defaultModels: [],
  },
  {
    id: 'edge_tts',
    name: 'Edge TTS',
    provider: 'microsoft',
    capability: 'tts',
    adapter: 'openai',
    apiBase: '',
    defaultModels: [],
  },
  {
    id: 'gsv_tts',
    name: 'GSV TTS(Local)',
    provider: 'gpt_sovits',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:9880',
    defaultModels: [],
  },
  {
    id: 'gsvi_tts',
    name: 'GSVI TTS(API)',
    provider: 'gpt_sovits',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:8000',
    defaultModels: [],
  },
  {
    id: 'fishaudio_tts',
    name: 'FishAudio TTS(API)',
    provider: 'fishaudio',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://api.fish.audio/v1',
    defaultModels: [],
  },
  {
    id: 'dashscope_tts',
    name: '阿里云百炼 TTS(API)',
    provider: 'dashscope',
    capability: 'tts',
    adapter: 'openai',
    apiBase: '',
    defaultModels: ['cosyvoice-v1'],
  },
  {
    id: 'azure_tts',
    name: 'Azure TTS',
    provider: 'azure',
    capability: 'tts',
    adapter: 'openai',
    apiBase: '',
    defaultModels: [],
  },
  {
    id: 'minimax_tts',
    name: 'MiniMax TTS(API)',
    provider: 'minimax',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://api.minimax.chat/v1/t2a_v2',
    defaultModels: ['speech-02-turbo'],
  },
  {
    id: 'volcengine_tts',
    name: '火山引擎 TTS(API)',
    provider: 'volcengine',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://openspeech.bytedance.com/api/v1/tts',
    defaultModels: [],
  },
  {
    id: 'gemini_tts',
    name: 'Gemini TTS',
    provider: 'google',
    capability: 'tts',
    adapter: 'gemini',
    apiBase: '',
    defaultModels: ['gemini-2.5-flash-preview-tts'],
  },
  {
    id: 'elevenlabs_tts',
    name: 'ElevenLabs TTS(API)',
    provider: 'elevenlabs',
    capability: 'tts',
    adapter: 'openai',
    apiBase: 'https://api.elevenlabs.io/v1',
    defaultModels: ['eleven_multilingual_v2'],
  },

  // ---- embedding（仅 openai/ollama 格式；Gemini/NVIDIA 走各自 openai 兼容端点，worker embed() 真可用） ----
  {
    id: 'openai_embedding',
    name: 'OpenAI Embedding',
    provider: 'openai',
    capability: 'embedding',
    adapter: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModels: ['text-embedding-3-small', 'text-embedding-3-large'],
  },
  {
    id: 'gemini_embedding',
    name: 'Gemini Embedding',
    provider: 'google',
    capability: 'embedding',
    adapter: 'openai',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModels: ['gemini-embedding-001', 'text-embedding-004'],
  },
  {
    id: 'nvidia_embedding',
    name: 'NVIDIA Embedding',
    provider: 'nvidia',
    capability: 'embedding',
    adapter: 'openai',
    apiBase: 'https://integrate.api.nvidia.com/v1',
    defaultModels: ['nvidia/llama-nemotron-embed-1b-v2'],
  },
  {
    id: 'ollama_embedding',
    name: 'Ollama Embedding',
    provider: 'ollama',
    capability: 'embedding',
    adapter: 'ollama',
    apiBase: 'http://127.0.0.1:11434',
    defaultModels: ['nomic-embed-text', 'bge-m3'],
  },

  // ---- rerank（openpet 暂无 runtime；adapter=openai 占位，多为 openai 兼容 /rerank） ----
  {
    id: 'vllm_rerank',
    name: 'vLLM Rerank',
    provider: 'vllm',
    capability: 'rerank',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:8000',
    defaultModels: ['BAAI/bge-reranker-base'],
  },
  {
    id: 'xinference_rerank',
    name: 'Xinference Rerank',
    provider: 'xinference',
    capability: 'rerank',
    adapter: 'openai',
    apiBase: 'http://127.0.0.1:9997',
    defaultModels: ['BAAI/bge-reranker-base'],
  },
  {
    id: 'bailian_rerank',
    name: '阿里云百炼重排序',
    provider: 'bailian',
    capability: 'rerank',
    adapter: 'openai',
    apiBase: 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
    defaultModels: ['qwen3-rerank'],
  },
  {
    id: 'nvidia_rerank',
    name: 'NVIDIA Rerank',
    provider: 'nvidia',
    capability: 'rerank',
    adapter: 'openai',
    apiBase: 'https://ai.api.nvidia.com/v1/retrieval',
    defaultModels: ['nv-rerank-qa-mistral-4b:1'],
  },
];

/**
 * 厂商键 → 图标 URL（照搬 AstrBot dashboard providerUtils getProviderIcon，lobehub CDN）。
 * 本地优先：renderer `<img>` 加载失败时回退首字母圆标（AstrBot 同款 fallback）；离线/CSP 拦截不影响可用。
 */
const PROVIDER_ICONS: Record<string, string> = {
  openai: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openai.svg',
  azure: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/azure.svg',
  xai: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/xai.svg',
  anthropic: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/anthropic.svg',
  ollama: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/ollama.svg',
  google: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg',
  deepseek:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/deepseek-color.svg',
  modelscope: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/modelscope.svg',
  zhipu: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/zhipu.svg',
  nvidia: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/nvidia-color.svg',
  siliconflow:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/siliconcloud.svg',
  moonshot: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/kimi.svg',
  'kimi-code': 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/kimi.svg',
  longcat: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/longcat-color.svg',
  ppio: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/ppio.svg',
  dify: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/dify-color.svg',
  coze: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.66.0/icons/coze.svg',
  dashscope:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/alibabacloud-color.svg',
  deerflow: 'https://cdn.jsdelivr.net/gh/bytedance/deer-flow@main/frontend/public/images/deer.svg',
  fastgpt: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/fastgpt-color.svg',
  lm_studio: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/lmstudio.svg',
  fishaudio: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/fishaudio.svg',
  minimax: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/minimax.svg',
  'minimax-token-plan':
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/minimax.svg',
  mimo: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/xiaomi.svg',
  xiaomi: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/xiaomi.svg',
  'xiaomi-token-plan': 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/xiaomi.svg',
  '302ai': 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.53.0/icons/ai302-color.svg',
  microsoft: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/microsoft.svg',
  vllm: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/vllm-color.svg',
  groq: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/groq.svg',
  aihubmix:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/aihubmix-color.svg',
  openrouter: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/openrouter.svg',
  tokenpony: 'https://tokenpony.cn/tokenpony-web/logo.png',
  compshare: 'https://compshare.cn/favicon.ico',
  xinference:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/xinference-color.svg',
  bailian: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/bailian-color.svg',
  volcengine:
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/volcengine-color.svg',
  elevenlabs: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/elevenlabs.svg',
  gpt_sovits: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/lobehub.svg',
};

/** 厂商键 → 图标 URL；未知返回空串（renderer 退回首字母圆标）。 */
export function providerIconUrl(provider: string): string {
  return PROVIDER_ICONS[provider] ?? '';
}

/**
 * 某能力（provider_type）的**类型专属配置字段** —— 照 AstrBot `items` 元数据，
 * 让每种 provider 的「点进去配置」字段集不同（chat 走 models 表 + caps，无额外字段；
 * 非 chat 各有专属字段，经 ConfigSectionRenderer 渲染，存进 ProviderSource.config）。
 *
 * MVP 取每个 provider_type 的代表性字段（非逐 provider 全字段）；exotic 逐 provider 参数
 *（edge_tts rate/volume/pitch、gsv 一堆）留 follow-up。维度/音色等暂「存而不接」（持久不消费）。
 */
export function providerConfigMeta(capability: Capability): ConfigItemMeta[] {
  const meta = (raw: Partial<ConfigItemMeta> & { key: string }): ConfigItemMeta =>
    ConfigItemMetaSchema.parse(raw);
  switch (capability) {
    case 'embedding':
      return [
        meta({
          key: 'model',
          label: '嵌入模型',
          hint: '如 text-embedding-3-small / nomic-embed-text',
        }),
        meta({
          key: 'dimensions',
          label: '向量维度',
          type: 'int',
          hint: '部分模型可配；留默认即可',
        }),
      ];
    case 'rerank':
      return [
        meta({ key: 'model', label: '重排序模型', hint: '如 bge-reranker-v2-m3' }),
        meta({
          key: 'rerankApiSuffix',
          label: 'API 路径后缀',
          hint: '追加到 Base URL，如 /v1/rerank；留空不追加',
        }),
        meta({ key: 'returnDocuments', label: '返回文档原文', type: 'bool' }),
      ];
    case 'stt':
      return [meta({ key: 'model', label: '语音模型', hint: '如 whisper-1' })];
    case 'tts':
      return [
        meta({ key: 'model', label: '语音模型', hint: '如 tts-1 / cosyvoice-v1' }),
        meta({ key: 'voice', label: '音色', hint: '如 alloy / zh-CN-XiaoxiaoNeural' }),
        meta({ key: 'format', label: '音频格式', hint: '如 mp3 / wav' }),
      ];
    case 'agent_runner':
      return [
        meta({
          key: 'agentApiType',
          label: '应用类型',
          hint: '如 dify chat/workflow、dashscope agent',
        }),
        meta({
          key: 'agentAppId',
          label: '应用 / Bot ID',
          hint: 'Dify App / Coze Bot / 百炼 App ID',
        }),
      ];
    case 'chat':
    default:
      return [];
  }
}
