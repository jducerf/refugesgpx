import { Banknote, Bed, BedDouble, Cross, Droplets, Home, Mountain, ShoppingBag, Tent, Toilet, TrainFront, TriangleAlert, Waves, type LucideIcon } from 'lucide-react';
import type { TypeMeta } from '@/lib/types';
import { cn } from '@/lib/cn';

const MAP: Record<TypeMeta['iconKey'], LucideIcon> = {
  home: Home,
  tent: Tent,
  bed: BedDouble,
  droplet: Droplets,
  alert: TriangleAlert,
  waves: Waves,
  mountain: Mountain,
  bag: ShoppingBag,
  train: TrainFront,
  bed_single: Bed,
  cross: Cross,
  banknote: Banknote,
  toilet: Toilet,
};

interface TypeIconProps {
  meta: TypeMeta;
  /** Taille en px (défaut 18) */
  size?: number;
  /** Affiche le marker (cercle coloré) plutôt qu'une icône monochrome */
  marker?: boolean;
  className?: string;
}

export function TypeIcon({ meta, size = 18, marker = false, className }: TypeIconProps) {
  const Icon = MAP[meta.iconKey];
  if (marker) {
    const ring = Math.round(size * 1.55);
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-ink)]',
          className,
        )}
        style={{ width: ring, height: ring, backgroundColor: meta.color }}
        aria-label={meta.label}
      >
        <Icon size={size} color="white" strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <Icon
      size={size}
      color={meta.color}
      strokeWidth={2.2}
      className={cn('shrink-0', className)}
      aria-hidden
    />
  );
}
