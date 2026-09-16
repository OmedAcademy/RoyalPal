type CheckboxGroupProps = {
  label: string;
  name: string;
  options: readonly string[];
  defaultValues?: readonly string[] | null;
};

export function CheckboxGroup({ label, name, options, defaultValues }: CheckboxGroupProps) {
  const selected = new Set(defaultValues ?? []);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={selected.has(option)}
              className="accent-foreground"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
