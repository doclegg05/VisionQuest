"use client";

import { useEffect, useRef, useState } from "react";

import { FIELD_CLASS, LABEL_CLASS } from "@/components/staff/fieldStyles";
import { RegionNameField } from "./RegionNameField";
import type { NewRegionInput } from "./regions-api";
import { REGION_MESSAGES, REGIONS_COPY } from "./regions-copy";
import { REGION_CODE_MAX_LENGTH, suggestRegionCode, type AdminRegion } from "./regions-model";
import { ALERT_CLASS, MUTED_TEXT, PRIMARY_BUTTON, SECONDARY_BUTTON, SUBHEADING } from "./regionStyles";

interface AddRegionFormProps {
  /** Any request is in flight, so nothing may be sent. */
  busy: boolean;
  /** This form's own request is in flight. */
  adding: boolean;
  error: string | null;
  /** The last save failed because its short code is taken. */
  codeTaken: boolean;
  /** Every listed region, to warn about a name already in use. */
  regions: readonly AdminRegion[];
  /** Resolves true when the region was saved, so the form can clear. */
  onCreate: (input: NewRegionInput) => Promise<boolean>;
}

interface CodeFieldProps {
  code: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/** The short code input. It is a code, not words: no capitals, no spell-check. */
function CodeField({ code, onChange, inputRef }: CodeFieldProps) {
  return (
    <div>
      <label htmlFor="new-region-code" className={LABEL_CLASS}>{REGIONS_COPY.codeLabel}</label>
      <input
        id="new-region-code"
        ref={inputRef}
        required
        autoFocus
        maxLength={REGION_CODE_MAX_LENGTH}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby="new-region-code-help"
        value={code}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS}
      />
      <p id="new-region-code-help" className="mt-1 text-xs text-[var(--ink-muted)]">{REGIONS_COPY.codeHelp}</p>
    </div>
  );
}

/** The closed short code: what it will be, and a button to change it. */
function CodeSummary({ code, onOpen }: { code: string; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className={MUTED_TEXT}>{code ? REGION_MESSAGES.codeFromName(code) : REGIONS_COPY.codeFromNoName}</p>
      <button type="button" onClick={onOpen} className={SECONDARY_BUTTON}>{REGIONS_COPY.changeCode}</button>
    </div>
  );
}

export function AddRegionForm({ busy, adding, error, codeTaken, regions, onCreate }: AddRegionFormProps) {
  const [name, setName] = useState("");
  // Null means the code follows the name. Typing in the code field takes over;
  // clearing it hands the code back to the name.
  const [typedCode, setTypedCode] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const code = typedCode ?? suggestRegionCode(name);
  const showCode = codeOpen || codeTaken;

  // A taken code is the thing to fix, so the cursor goes to it.
  useEffect(() => {
    if (codeTaken) codeInput.current?.focus();
  }, [codeTaken]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await onCreate({ name, code })) {
      setName("");
      setTypedCode(null);
      setCodeOpen(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className={SUBHEADING}>{REGIONS_COPY.addHeading}</h3>
      <RegionNameField id="new-region-name" label={REGIONS_COPY.nameLabel} value={name} onChange={setName} regions={regions} error={null} />
      {showCode ? (
        <CodeField code={code} onChange={(value) => setTypedCode(value === "" ? null : value)} inputRef={codeInput} />
      ) : (
        <CodeSummary code={code} onOpen={() => setCodeOpen(true)} />
      )}
      {error && <p role="alert" className={ALERT_CLASS}>{error}</p>}
      <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
        {adding ? REGIONS_COPY.adding : REGIONS_COPY.add}
      </button>
    </form>
  );
}
