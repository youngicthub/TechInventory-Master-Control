import { useEffect, useState } from "react";

// A tiny hash router - no external routing library needed for six pages.
// Paths look like "#/customers/12"; navigate() pushes a new hash and the
// hashchange listener re-renders every subscriber.
export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): string[] {
  const [segments, setSegments] = useState(parseHash());

  useEffect(() => {
    const onHashChange = () => setSegments(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return segments;
}

function parseHash(): string[] {
  // "#/installations?status=offline" -> ["installations"]; the query part is read by useQueryParams().
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return hash.split("/").filter(Boolean);
}

/** Query parameters of the current hash route, e.g. ?status=offline (used by dashboard cards to open filtered lists). */
export function useQueryParams(): URLSearchParams {
  const [query, setQuery] = useState(() => window.location.hash.split("?")[1] ?? "");
  useEffect(() => {
    const onHashChange = () => setQuery(window.location.hash.split("?")[1] ?? "");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return new URLSearchParams(query);
}
