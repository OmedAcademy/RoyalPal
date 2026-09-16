type TextFieldProps = {
  label: string;
  name: string;
  type?: "text" | "email" | "url" | "number";
  defaultValue?: string | number | null;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  autoComplete?: string;
};

export function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  maxLength,
  min,
  max,
  step,
  placeholder,
  autoComplete,
}: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="rounded-md border border-black/15 px-3 py-2 dark:border-white/20"
      />
    </div>
  );
}
