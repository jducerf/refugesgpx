import { Home } from 'lucide-react';
import { FileDrop } from './FileDrop';
import { TraceInfo } from './TraceInfo';
import { Filters } from './Filters';
import { MeteoSection } from './MeteoSection';
import { POIList } from './POIList';
import { ExportButtons } from './ExportButtons';
import { useAppStore } from '@/store/useAppStore';

export function Panel() {
  const trace = useAppStore((s) => s.trace);
  const reset = useAppStore((s) => s.reset);

  return (
    <aside className="flex h-screen w-[380px] shrink-0 flex-col border-l border-[var(--color-paper-deep)] bg-white">
      <header className="flex items-center justify-between border-b border-[var(--color-paper-deep)] px-4 py-2">
        <a
          href="/"
          className="font-display flex items-baseline gap-1.5 text-sm font-semibold text-[var(--color-ink)] no-underline"
        >
          <span className="text-base leading-none" aria-hidden>
            🥾
          </span>
          Refuges<span className="text-[var(--color-accent)]">.</span>GPX
        </a>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              reset();
              document.body.classList.remove('is-app');
            }}
            className="rounded-md p-1 text-[var(--color-ink-mute)] transition hover:bg-[var(--color-paper-warm)] hover:text-[var(--color-ink)]"
            title="Retour à l'accueil"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          <a
            href="https://github.com/yoanbernabeu/refugesgpx"
            target="_blank"
            rel="noopener"
            className="rounded-md p-1 text-[var(--color-ink-mute)] transition hover:bg-[var(--color-paper-warm)] hover:text-[var(--color-ink)]"
            title="Code source GitHub"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 .5C5.4.5 0 5.9 0 12.5c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.8-1.6 8.2-6.1 8.2-11.4C24 5.9 18.6.5 12 .5z" />
            </svg>
          </a>
        </div>
      </header>

      {!trace ? <EmptyState /> : <FilledState />}

      {/* Attribution refuges.info / fond carte assurée par : (a) le bandeau
          de sources dans Filters, (b) le contrôle d'attribution natif de
          MapLibre sur la carte. Pas de footer dédié ici pour préserver la
          hauteur verticale destinée à la liste des POIs. */}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-7">
      <div>
        <p className="section-num">Étape 1 — votre tracé</p>
        <h2 className="font-display mt-2 text-2xl font-semibold leading-tight text-[var(--color-ink)]">
          Glissez le GPX de votre course.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Préparé sur OpenRunner, Komoot, Visorando, Strava ou un GPS. Le fichier reste
          dans votre navigateur.
        </p>
      </div>

      <FileDrop />

      <div className="mt-2 rounded-md border border-[var(--color-paper-deep)] bg-[var(--color-paper-warm)] p-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
        <p className="mb-1.5 font-semibold text-[var(--color-ink)]">À savoir</p>
        <ul className="space-y-1.5">
          <li className="flex gap-2">
            <span className="shrink-0 text-[var(--color-accent)]">▸</span>
            <span>
              Les <strong>refuges, cabanes, gîtes</strong> et <strong>points d'eau</strong> sont chargés depuis refuges.info.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 text-[var(--color-accent)]">▸</span>
            <span>
              Vous choisissez la <strong>distance autour du tracé</strong> (100 m à 5 km).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 text-[var(--color-accent)]">▸</span>
            <span>
              Export <strong>GPX enrichi</strong> et <strong>topo PDF</strong> imprimable.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function FilledState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Bloc fixe en haut : trace + filtres + météo */}
      <div className="space-y-2.5 px-4 py-2.5">
        <TraceInfo />
        <Filters />
        <MeteoSection />
      </div>
      {/* Liste POI : remplit toute la hauteur disponible et scrolle */}
      <div className="flex min-h-0 flex-1 flex-col px-4">
        <POIList />
      </div>
      {/* Boutons d'export en sticky bottom : toujours accessibles même quand
          on scrolle dans une longue liste de POIs. */}
      <div className="border-t border-[var(--color-paper-deep)] bg-white px-4 py-2">
        <ExportButtons />
      </div>
    </div>
  );
}
