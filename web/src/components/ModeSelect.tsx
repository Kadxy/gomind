import { ToggleGroup } from '@/components/ui/ToggleGroup';
import type { Mode, Stone } from '@/game/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ModeSelectProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  humanSide: Stone;
  onHumanSideChange: (s: Stone) => void;
}

export function ModeSelect({ mode, onModeChange, humanSide, onHumanSideChange }: ModeSelectProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">对战模式</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="模式">
          <ToggleGroup<Mode>
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'pvp-local', label: '同屏双人' },
              { value: 'pvc', label: '人机' },
              { value: 'selfplay', label: '机机' },
            ]}
          />
        </Field>
        {mode === 'pvc' && (
          <Field label="你执">
            <ToggleGroup<string>
              value={String(humanSide)}
              onChange={(v) => onHumanSideChange(Number(v) as Stone)}
              options={[
                {
                  value: '1',
                  label: '黑 · 先手',
                  icon: <Dot color="#111827" />,
                },
                {
                  value: '2',
                  label: '白 · 后手',
                  icon: <Dot color="#f9fafb" border="#9ca3af" />,
                },
              ]}
            />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Dot({ color, border = color }: { color: string; border?: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full border"
      style={{ background: color, borderColor: border }}
    />
  );
}
