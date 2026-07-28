import { invalidatePrefix } from "@/lib/cache";
import { prismaAdmin } from "@/lib/db";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { checkOllamaHealth } from "./health";
import {
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
import type { HealthResult } from "./health";
import type { SystemConfigKey } from "@/lib/system-config";

export interface LocalRoutingActivationInput {
  actorId: string;
  defaultModel: string;
  speedModel: string;
  qualityModel: string;
  enabled: true;
}

export interface LocalRoutingActivationResult {
  enabled: true;
  models: {
    default: string;
    speed: string;
    quality: string;
  };
  inventory: string[];
}

interface LocalRoutingActivationDependencies {
  inspectInventory(input: {
    defaultModel: string;
  }): Promise<HealthResult>;
  persist(input: {
    actorId: string;
    values: ReadonlyArray<readonly [SystemConfigKey, string]>;
    inventory: string[];
  }): Promise<void>;
}

export class LocalRoutingActivationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "LocalRoutingActivationError";
  }
}

function assertModelFamily(
  model: string,
  family: "gemma" | "qwen",
  label: string,
): void {
  if (!model.toLowerCase().includes(family)) {
    throw new LocalRoutingActivationError(
      `${label} must be configured as a ${family === "gemma" ? "Gemma" : "Qwen"} model.`,
    );
  }
}

async function inspectConfiguredInventory(input: {
  defaultModel: string;
}): Promise<HealthResult> {
  const config = await readLocalAiProviderConfig();
  if (!config.url || !isSafeAiProviderUrl(config.url)) {
    throw new LocalRoutingActivationError(
      "A safe local AI provider URL must be configured before task routing can be enabled.",
    );
  }

  return checkOllamaHealth(config.url, {
    timeoutMs: 300_000,
    model: input.defaultModel,
    authConfig: toLocalAiAuthConfig(config),
  });
}

async function persistActivation(input: {
  actorId: string;
  values: ReadonlyArray<readonly [SystemConfigKey, string]>;
  inventory: string[];
}): Promise<void> {
  await prismaAdmin.$transaction(async (tx) => {
    for (const [key, value] of input.values) {
      await tx.systemConfig.upsert({
        where: { key },
        update: { value, updatedBy: input.actorId },
        create: { key, value, updatedBy: input.actorId },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: "admin",
        action: "admin.ai_local_task_routing.activate",
        targetType: "system_config",
        targetId: "ai_local_task_routing_enabled",
        summary:
          "Validated the local model inventory and atomically enabled local task routing.",
        metadata: JSON.stringify({
          inventory: input.inventory,
          configuredKeys: input.values.map(([key]) => key),
        }),
      },
    });
  });

  for (const [key] of input.values) {
    invalidatePrefix(`sysconfig:${key}`);
  }
}

const defaultDependencies: LocalRoutingActivationDependencies = {
  inspectInventory: inspectConfiguredInventory,
  persist: persistActivation,
};

/**
 * Validate all three local candidates, then commit the model configuration,
 * availability proofs, enabled flag, and audit record in one transaction.
 * No configuration is changed when validation fails.
 */
export async function activateLocalTaskRouting(
  input: LocalRoutingActivationInput,
  dependencies: LocalRoutingActivationDependencies = defaultDependencies,
): Promise<LocalRoutingActivationResult> {
  assertModelFamily(input.defaultModel, "gemma", "Default model");
  assertModelFamily(input.speedModel, "qwen", "Speed model");
  assertModelFamily(input.qualityModel, "gemma", "Quality model");

  const health = await dependencies.inspectInventory({
    defaultModel: input.defaultModel,
  });
  if (!health.healthy || !health.chatValidated) {
    throw new LocalRoutingActivationError(
      `Local model health validation failed: ${health.error ?? "the default Gemma chat path was not validated"}.`,
    );
  }

  const inventory = health.models ?? [];
  const installed = new Set(inventory);
  for (const model of [
    input.defaultModel,
    input.speedModel,
    input.qualityModel,
  ]) {
    if (!installed.has(model)) {
      throw new LocalRoutingActivationError(
        `Local model inventory is missing required model ${model}.`,
      );
    }
  }

  const values = [
    ["ai_local_model_default", input.defaultModel],
    ["ai_local_model_default_available", "true"],
    ["ai_local_model_speed", input.speedModel],
    ["ai_local_model_speed_available", "true"],
    ["ai_local_model_quality", input.qualityModel],
    ["ai_local_model_quality_available", "true"],
    // Written inside the same transaction as every model key and the audit
    // record. Ordering is documentary; transaction atomicity is the guard.
    ["ai_local_task_routing_enabled", "true"],
  ] as const satisfies ReadonlyArray<readonly [SystemConfigKey, string]>;

  await dependencies.persist({
    actorId: input.actorId,
    values,
    inventory,
  });

  return {
    enabled: true,
    models: {
      default: input.defaultModel,
      speed: input.speedModel,
      quality: input.qualityModel,
    },
    inventory,
  };
}
