// Zero-hallucination rendering: every clinic field must go through this
// component. `null` always renders as an explicit "Unknown" badge — never a
// guessed false/"No"/blank. Callers should never write ternaries like
// `{clinic.accepts_walk_ins ? "Yes" : "No"}` directly against a nullable field.
type Props =
  | { kind: "text"; value: string | null }
  | { kind: "boolean"; value: boolean | null; trueLabel: string; falseLabel: string }
  | { kind: "number"; value: number | null; unit?: string };

export default function FieldValue(props: Props) {
  if (props.kind === "text") {
    return props.value === null || props.value === "" ? (
      <UnknownBadge />
    ) : (
      <span>{props.value}</span>
    );
  }

  if (props.kind === "boolean") {
    if (props.value === null) return <UnknownBadge />;
    return <span>{props.value ? props.trueLabel : props.falseLabel}</span>;
  }

  if (props.kind === "number") {
    return props.value === null ? (
      <UnknownBadge />
    ) : (
      <span>
        {props.value}
        {props.unit ?? ""}
      </span>
    );
  }

  return null;
}

function UnknownBadge() {
  return (
    <span
      className="italic text-gray-400 dark:text-gray-500"
      title="Not confirmed by source data"
    >
      Unknown
    </span>
  );
}
