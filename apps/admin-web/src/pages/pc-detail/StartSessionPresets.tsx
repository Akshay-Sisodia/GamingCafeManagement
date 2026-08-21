const START_PRESETS = [30, 60, 90, 120];

export function PresetMinuteButtons({
  minutes,
  onPreset,
}: {
  minutes: number;
  onPreset: (minutes: number) => void;
}) {
  return (
    <>
      {START_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onPreset(preset)}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            minutes === preset
              ? "bg-emerald-600 text-white"
              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          }`}
        >
          {preset} min
        </button>
      ))}
    </>
  );
}

export function StartSessionPresets({
  minutes,
  disabled,
  pending,
  onPreset,
  onMinutesChange,
  onStart,
}: {
  minutes: number;
  disabled: boolean;
  pending: boolean;
  onPreset: (minutes: number) => void;
  onMinutesChange: (minutes: number) => void;
  onStart: () => void;
}) {
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-zinc-500">No active session. Start one for a walk-in customer:</p>
      <div className="flex flex-wrap gap-2">
        <PresetMinuteButtons minutes={minutes} onPreset={onPreset} />
        <input
          type="number"
          min={5}
          max={1440}
          value={minutes}
          onChange={(e) => onMinutesChange(Number.parseInt(e.target.value, 10) || 0)}
          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          aria-label="Custom minutes"
        />
      </div>
      <button
        type="button"
        disabled={disabled || pending || minutes < 5}
        onClick={onStart}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {pending ? "Starting…" : `Start ${minutes} min session`}
      </button>
      {disabled ? (
        <p className="text-xs text-amber-400">
          This PC is not available — set it online in settings first.
        </p>
      ) : null}
    </div>
  );
}
