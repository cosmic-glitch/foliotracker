import { useEffect, useState } from 'react';
import { readWebAppSignals, isIosWebApp, type WebAppSignals } from '../lib/webApp';

declare const __BUILD_TIME__: string;

// Hidden diagnostics overlay: open the site with `?diag=1` (or add that URL to
// the Home Screen) to see what the device reports for web-app detection —
// used to chase the iOS 27 status-bar blur band without a debugger attached.
export function WebAppDiag() {
  const [signals, setSignals] = useState<WebAppSignals | null>(null);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('diag')) return;
    const update = () => setSignals(readWebAppSignals());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  if (!signals) return null;
  return (
    <pre
      className="fixed bottom-0 left-0 right-0 z-[100] m-0 max-h-[45vh] overflow-auto bg-black/90 p-3 text-[11px] leading-snug text-green-300 whitespace-pre-wrap break-all"
    >
      {JSON.stringify(
        { build: __BUILD_TIME__, iosWebApp: isIosWebApp(signals), htmlClass: document.documentElement.className, ...signals },
        null,
        1,
      )}
    </pre>
  );
}
