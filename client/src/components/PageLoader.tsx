/**
 * Full-page fallback shown by <Suspense> while a lazy-loaded route chunk
 * (see App.tsx) is still downloading/parsing. This is NOT the small inline
 * spinner (@/components/ui/Spinner) used for in-page/button loading states;
 * that one is untouched and still used everywhere it already was.
 */

export function PageLoader() {
  return <div className="">Loading...</div>;
}
