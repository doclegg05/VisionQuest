import { JOB_SOURCE_OPTIONS } from "./source-options";
import { JOB_SOURCE_ADAPTER_BY_KEY } from "./adapters/registry";

export interface JobSourceConfigurationStatus {
  source: string;
  label: string;
  configured: boolean;
  selected: boolean;
}

export function getJobSourceConfigurationStatus(
  selectedSources: string[] = [],
): JobSourceConfigurationStatus[] {
  const selected = new Set(selectedSources);

  return JOB_SOURCE_OPTIONS.map((option) => ({
    source: option.value,
    label: option.label,
    configured: JOB_SOURCE_ADAPTER_BY_KEY.get(option.value)?.isConfigured() ?? false,
    selected: selected.has(option.value),
  }));
}

