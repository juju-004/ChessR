/**
 * Full-page fallback shown by <Suspense> while a lazy-loaded route chunk
 * (see App.tsx) is still downloading/parsing. Deliberately plain — just
 * "Loading…" — since this is meant to be swapped for a custom design
 * later. This is NOT the small inline spinner (@/components/ui/Spinner)
 * used for in-page/button loading states; that one is untouched and still
 * used everywhere it already was.
 */
export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center text-base-content/60">
      Loading...
    </div>
  );
}
