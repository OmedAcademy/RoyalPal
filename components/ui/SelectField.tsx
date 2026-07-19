type SelectFieldProps = {
  label: string;
  name: string;
  options: readonly string[] | readonly { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
};

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  required,
  placeholder = "Select...",
}: SelectFieldProps) {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
      >
        <option value="">{placeholder}</option>
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
