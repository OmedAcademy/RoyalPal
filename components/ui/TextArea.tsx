type TextAreaProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  hint?: string;
};

export function TextArea({
  label,
  name,
  defaultValue,
  required,
  maxLength,
  rows = 4,
  placeholder,
  hint,
}: TextAreaProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        defaultValue={defaultValue ?? undefined}
        required={required}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className="resize-y rounded-md border border-black/15 px-3 py-2 dark:border-white/20"
      />
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}
