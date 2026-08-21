export function KitchenErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-lg font-medium text-red-700">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-12 rounded-lg bg-red-600 px-5 text-base font-bold text-white hover:bg-red-500"
      >
        Retry
      </button>
    </div>
  );
}
