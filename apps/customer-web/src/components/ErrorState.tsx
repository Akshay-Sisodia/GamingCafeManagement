interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
      <p className="text-sm text-red-300">{message ?? "Something went wrong."}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/20"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
