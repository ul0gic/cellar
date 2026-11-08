// Read 2026-11-08 at developers.openai.com/api/docs/models: cost-sensitive text tier and the cheaper fast image tier.
export const AiModels = {
  text: 'gpt-6-luna',
  image: 'gpt-image-2.6-flare',
  baseUrl: new URL('https://api.openai.com/v1/'),
} as const;
