import type { ProviderCategory } from "@/types";
import type { PresetTheme } from "./claudeProviderPresets";
import {
  getPiModelCatalogReference,
  type PiCatalogModel,
} from "./piModelCatalog";
import {
  getPiThinkingProfile,
  resolvePiThinkingProfile,
  type PiThinkingLevelMap,
} from "./piThinkingProfiles";
import type { PresetFamilyFields } from "./presetFamilies";
import {
  AIFUSION_NAME,
  AIFUSION_WEBSITE_URL,
  AIFUSION_BASE_URL,
  AIFUSION_MODEL,
  AIFUSION_LIGHT_MODEL,
  AIFUSION_MODEL_CONTEXT,
} from "./aifusionPlatform";

export type PiApiFormat =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "bedrock-converse-stream";

export type PiPresetModel = PiCatalogModel & {
  thinkingLevelMap?: PiThinkingLevelMap;
  compat?: Record<string, unknown>;
};

export interface PiProviderPreset extends PresetFamilyFields {
  name: string;
  nameKey?: string;
  providerKey: string;
  websiteUrl: string;
  apiKeyUrl?: string;
  settingsConfig: {
    name: string;
    baseUrl: string;
    api: PiApiFormat;
    apiKey: string;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    models: PiPresetModel[];
  };
  category?: ProviderCategory;
  isPartner?: boolean;
  primePartner?: boolean;
  partnerPromotionKey?: string;
  theme?: PresetTheme;
  icon?: string;
  iconColor?: string;
}

/**
 * Pi-native provider catalog.
 *
 * This list is independently maintained because provider protocol, endpoint
 * roots and model capabilities are application-specific. It was initially
 * aligned with the OpenCode catalog, but Pi does not import or derive from
 * another application's presets at runtime.
 */
const piProviderPresetDefinitions: PiProviderPreset[] = [
  {
    name: AIFUSION_NAME,
    providerKey: "aifusion",
    websiteUrl: AIFUSION_WEBSITE_URL,
    category: "third_party",
    settingsConfig: {
      name: "aifusion",
      baseUrl: AIFUSION_BASE_URL,
      api: "openai-completions",
      apiKey: "",
      models: [
        {
          id: AIFUSION_MODEL,
          name: AIFUSION_MODEL,
          reasoning: true,
          input: ["text", "image"],
          contextWindow: AIFUSION_MODEL_CONTEXT,
          maxTokens: 32000,
        },
        {
          id: AIFUSION_LIGHT_MODEL,
          name: "GLM 5.3 Flash",
          reasoning: true,
          input: ["text"],
          contextWindow: 200000,
          maxTokens: 32000,
        },
      ] as unknown as PiPresetModel[],
    },
    icon: "openai",
    iconColor: "#6366F1",
  },
];

function materializeVerifiedThinkingProfiles(
  preset: PiProviderPreset,
): PiProviderPreset {
  return {
    ...preset,
    settingsConfig: {
      ...preset.settingsConfig,
      models: preset.settingsConfig.models.map((model) => {
        const reference = getPiModelCatalogReference(model);
        if (!reference) return model;
        const resolved = reference.presetThinkingProfileId
          ? getPiThinkingProfile(reference.presetThinkingProfileId)
          : resolvePiThinkingProfile({
              catalogKey: reference.catalogKey,
              api: preset.settingsConfig.api,
            });
        return {
          ...model,
          ...(model.reasoning ? { thinkingLevelMap: resolved?.map ?? {} } : {}),
          ...(resolved?.modelCompat
            ? {
                compat: {
                  ...model.compat,
                  ...resolved.modelCompat,
                },
              }
            : {}),
        };
      }),
    },
  };
}

export const piProviderPresets = piProviderPresetDefinitions.map(
  materializeVerifiedThinkingProfiles,
);
