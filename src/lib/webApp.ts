// iOS home-screen ("Add to Home Screen") web-app detection.
//
// iOS 26+ paints a Liquid Glass "scroll edge" blur ~16px below the status bar
// of installed web apps, on top of page content (iOS 27 made it far more
// visible). Nothing in CSS/meta disables it, so index.css pads the page down
// under `html.ios-web-app` and the band lands on empty background.
//
// Detection is done here in JS rather than via `@media (display-mode:
// standalone)` alone: since iOS 26 every home-screen site opens as a web app,
// manifest or not, and the CSS-only gate did not match on an iOS 27 phone.
// Any of the signals below flips the class; the `?diag=1` overlay
// (WebAppDiag) shows what a given device reports.

export interface WebAppSignals {
  iosUA: boolean;
  navigatorStandalone: string;
  displayModeStandalone: boolean;
  displayModeFullscreen: boolean;
  touchCallout: boolean;
  safeAreaTop: string;
  innerHeight: number;
  screenHeight: number;
  visualViewportHeight: number | undefined;
  userAgent: string;
}

export function readWebAppSignals(): WebAppSignals {
  const nav = navigator as Navigator & { standalone?: boolean };
  const probe = document.createElement('div');
  probe.style.paddingTop = 'env(safe-area-inset-top)';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const safeAreaTop = getComputedStyle(probe).paddingTop;
  probe.remove();
  return {
    iosUA:
      /iP(hone|ad|od)/.test(nav.userAgent) ||
      (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1),
    navigatorStandalone: String(nav.standalone),
    displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
    displayModeFullscreen: matchMedia('(display-mode: fullscreen)').matches,
    touchCallout: CSS.supports('-webkit-touch-callout', 'none'),
    safeAreaTop,
    innerHeight: window.innerHeight,
    screenHeight: screen.height,
    visualViewportHeight: window.visualViewport?.height,
    userAgent: nav.userAgent,
  };
}

export function isIosWebApp(s: WebAppSignals): boolean {
  return (
    s.iosUA &&
    (s.navigatorStandalone === 'true' || s.displayModeStandalone || s.displayModeFullscreen)
  );
}

// Runs once at startup, before React renders, so the padding is there on
// first paint (no layout jump).
export function applyWebAppClass(): WebAppSignals {
  const signals = readWebAppSignals();
  if (isIosWebApp(signals)) document.documentElement.classList.add('ios-web-app');
  return signals;
}
