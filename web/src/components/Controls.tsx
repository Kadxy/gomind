import { Button } from '@/components/ui/Button';
import { RotateCcw, Undo2, RefreshCw } from 'lucide-react';

interface ControlsProps {
  onReset: () => void;
  onUndo: () => void;
  onSwap?: () => void;
  canUndo: boolean;
  swapLabel?: string;
}

export function Controls({ onReset, onUndo, onSwap, canUndo, swapLabel }: ControlsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={onReset} variant="outline" size="sm">
        <RotateCcw className="size-4" /> 重开
      </Button>
      <Button onClick={onUndo} variant="outline" size="sm" disabled={!canUndo}>
        <Undo2 className="size-4" /> 悔棋
      </Button>
      {onSwap && (
        <Button onClick={onSwap} variant="outline" size="sm">
          <RefreshCw className="size-4" /> {swapLabel ?? '切换先后手'}
        </Button>
      )}
    </div>
  );
}
