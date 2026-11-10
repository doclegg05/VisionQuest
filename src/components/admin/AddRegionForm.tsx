"use client";

import { useState } from "react";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/staff/fieldStyles";
import type { NewRegionInput } from "./regions-api";
import { REGIONS_COPY } from "./regions-copy";
import { REGION_CODE_MAX_LENGTH, suggestRegionCode } from "./regions-model";
import { ALERT_CLASS, PRIMARY_BUTTON, SUBHEADING } from "./regionStyles";

interface AddRegionFormProps {
  /** Any request is in flight, so nothing may be sent. */
  busy: boolean;
  /** This form's own request is in flight. */
  adding: boolean;
  error: string | null;
  /** Resolves true when the region was saved, so the form can clear. */
  onCreate: (input: NewRegionInput) => Promise<boolean>;
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  /** A short hint under the field, read out with it. */
  help?: string;
  /** A code, not words: the phone keyboard does not capitalize or spell-check it. */
  code?: boolean;
}

function TextField({ id, label, value, maxLength, onChange, help, code = false }: TextFieldProps) {
  const helpId = `${id}-help`;
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      <input
        id={id}
        required
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize={code ? "none" : undefined}
        spellCheck={code ? false : undefined}
        aria-describedby={help ? helpId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS}
      />
      {help && <p id={helpId} className="mt-1 text-xs text-[var(--ink-muted)]">{help}</p>}
    </div>
  );
}

export function AddRegionForm({ busy, adding, error, onCreate }: AddRegionFormProps) {
  const [name, setName] = useState("");
  // Null means the code follows the name. Typing in the code field takes over.
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const code = typedCode ?? suggestRegionCode(name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await onCreate({ name, code })) {
      setName("");
      setTypedCode(null);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className={SUBHEADING}>{REGIONS_COPY.addHeading}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="new-region-name" label={REGIONS_COPY.nameLabel} value={name} maxLength={200} onChange={setName} />
        <TextField
          id="new-region-code"
          label={REGIONS_COPY.codeLabel}
          value={code}
          maxLength={REGION_CODE_MAX_LENGTH}
          onChange={setTypedCode}
          help={REGIONS_COPY.codeHelp}
          code
        />
      </div>
      {error && <p role="alert" className={ALERT_CLASS}>{error}</p>}
      <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
        {adding ? REGIONS_COPY.adding : REGIONS_COPY.add}
      </button>
    </form>
  );
}
