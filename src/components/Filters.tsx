import { Slider } from './ui/Slider';
import { Checkbox } from './ui/Checkbox';
import { TypeIcon } from './TypeIcon';
import { useAppStore } from '@/store/useAppStore';
import { BUFFER_STEPS, REFUGES_TYPE_KEYS, TYPE_LABELS, type TypeKey } from '@/lib/types';

export function Filters() {
  const bufferStepIdx = useAppStore((s) => s.bufferStepIdx);
  const setBufferStepIdx = useAppStore((s) => s.setBufferStepIdx);
  const enabledTypes = useAppStore((s) => s.enabledTypes);
  const toggleType = useAppStore((s) => s.toggleType);

  return (
    <section className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-700">Distance du tracé</span>
          <span className="text-sm font-semibold text-[var(--color-accent)]">
            {BUFFER_STEPS[bufferStepIdx]?.label}
          </span>
        </div>
        <Slider
          min={0}
          max={BUFFER_STEPS.length - 1}
          step={1}
          value={[bufferStepIdx]}
          onValueChange={([v]) => v !== undefined && setBufferStepIdx(v)}
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
          <span>100 m</span>
          <span>5 km</span>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-700">Types de POIs</div>
        <div className="grid grid-cols-1 gap-y-1.5 text-sm">
          {REFUGES_TYPE_KEYS.map((k) => {
            const meta = TYPE_LABELS[k];
            const checked = enabledTypes.has(k);
            return (
              <label
                key={k}
                className="flex cursor-pointer items-center gap-2.5 text-slate-800"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleType(k as TypeKey)}
                />
                <TypeIcon meta={meta} size={16} marker />
                <span className="text-xs">{meta.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}
