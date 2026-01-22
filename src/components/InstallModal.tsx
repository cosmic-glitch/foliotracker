import { X, Share, MoreVertical } from 'lucide-react';

interface InstallModalProps {
  onClose: () => void;
}

export function InstallModal({ onClose }: InstallModalProps) {
  // Detect platform to show relevant instructions first
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-background rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>

        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Add to Home Screen
        </h2>
        <p className="text-text-secondary text-sm mb-6">
          Install FolioTracker on your phone for quick access.
        </p>

        <div className="space-y-6">
          {/* Show user's platform first */}
          {isIOS ? (
            <>
              <IOSInstructions />
              <AndroidInstructions />
            </>
          ) : isAndroid ? (
            <>
              <AndroidInstructions />
              <IOSInstructions />
            </>
          ) : (
            <>
              <IOSInstructions />
              <AndroidInstructions />
            </>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 bg-accent hover:bg-accent/90 text-white font-medium py-2 px-4 rounded-xl transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function IOSInstructions() {
  return (
    <div>
      <h3 className="font-medium text-text-primary mb-3 flex items-center gap-2">
        <span className="text-lg">iPhone / iPad</span>
        <span className="text-xs bg-text-secondary/20 text-text-secondary px-2 py-0.5 rounded">Safari</span>
      </h3>
      <ol className="text-sm text-text-secondary space-y-2">
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">1.</span>
          <span>
            Tap the <Share className="inline w-4 h-4 text-accent -mt-0.5" /> Share button at the bottom of the screen
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">2.</span>
          <span>Scroll down and tap <strong className="text-text-primary">Add to Home Screen</strong></span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">3.</span>
          <span>Tap <strong className="text-text-primary">Add</strong> in the top right</span>
        </li>
      </ol>
    </div>
  );
}

function AndroidInstructions() {
  return (
    <div>
      <h3 className="font-medium text-text-primary mb-3 flex items-center gap-2">
        <span className="text-lg">Android</span>
        <span className="text-xs bg-text-secondary/20 text-text-secondary px-2 py-0.5 rounded">Chrome</span>
      </h3>
      <ol className="text-sm text-text-secondary space-y-2">
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">1.</span>
          <span>
            Tap the <MoreVertical className="inline w-4 h-4 text-accent -mt-0.5" /> menu button in the top right
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">2.</span>
          <span>Tap <strong className="text-text-primary">Add to Home screen</strong> or <strong className="text-text-primary">Install app</strong></span>
        </li>
        <li className="flex items-start gap-2">
          <span className="font-medium text-text-primary">3.</span>
          <span>Tap <strong className="text-text-primary">Add</strong> to confirm</span>
        </li>
      </ol>
    </div>
  );
}
