/**
 * Transient message pinned under the header. Controlled: render it with a
 * message and remove it when done. `id` restarts the entry animation when
 * the same text is shown again.
 */
export function Toast({ message, id }: { message: string | null; id?: number }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <output
        key={id}
        aria-live="polite"
        className="max-w-sm rounded-full bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
      >
        {message}
      </output>
    </div>
  );
}
