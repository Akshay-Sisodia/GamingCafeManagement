export function IconAction({
  title,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 ring-1 ring-inset transition disabled:opacity-40 ${
        danger
          ? "text-red-400 ring-red-500/30 hover:bg-red-500/10"
          : "text-zinc-300 ring-zinc-700 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
