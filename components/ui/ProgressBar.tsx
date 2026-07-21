type ProgressBarProps = {
  percentage: number;
  label?: string;
};

export function ProgressBar({ percentage, label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{label}</span>
          <span className="text-zinc-600 dark:text-zinc-400">{clamped}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
      >
        <div
          className="bg-foreground h-full rounded-full transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
