import { useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import type { CareRecord, Station, Vehicle } from '../types';
import { useTabPanePortal } from './tabPanePortal';

type SheetProps = {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  records?: CareRecord[];
  stations?: Station[];
};

type FabProps = {
  vehicles: Vehicle[];
  records?: CareRecord[];
  stations?: Station[];
  /** Loaded on open so the home shell does not read the station list. */
  loadStations?: () => Promise<Station[]>;
};

/** Fixed FAB above the tab bar (home). Does not scroll with the list. */
export function QuickEntryFab({
  vehicles,
  records = [],
  stations: stationsProp = [],
  loadStations,
}: FabProps) {
  const { t } = useI18n();
  const portal = useTabPanePortal();
  const [open, setOpen] = useState(false);
  const [stations, setStations] = useState<Station[]>(stationsProp);
  const [Sheet, setSheet] = useState<ComponentType<SheetProps> | null>(null);
  if (vehicles.length === 0) return null;

  const openSheet = () => {
    setOpen(true);
    if (!Sheet) {
      void import('./QuickEntrySheet').then((m) => {
        setSheet(() => m.QuickEntrySheet);
      });
    }
    if (loadStations) {
      void loadStations().then(setStations);
    }
  };

  const ui = (
    <>
      <button
        type="button"
        className="qe-fab"
        onClick={openSheet}
        aria-label={t('qe.title')}
        title={t('qe.fabTitle')}
      >
        <span className="qe-fab-icon" aria-hidden>
          ✏️
        </span>
        <span className="qe-fab-label">{t('qe.fab')}</span>
      </button>
      {Sheet ? (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          vehicles={vehicles}
          records={records}
          stations={stations}
        />
      ) : null}
    </>
  );
  // While the home pane is translated, fixed UI must live on that pane so it
  // slides with the page and stays out of the scrolling content.
  return portal ? createPortal(ui, portal) : ui;
}
