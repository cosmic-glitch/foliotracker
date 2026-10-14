import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// <BrowserRouter> has no scroll management (<ScrollRestoration> needs a data
// router), so a Link clicked low on the landing page would open the next page
// at the same scrollY. Reset on forward navigations to a new path; leave
// back/forward (POP) to the browser's own restoration, and ignore
// search-param-only changes (Compare page scrolls those itself).
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path changes only
  }, [pathname]);
  return null;
}
