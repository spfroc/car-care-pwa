import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RECORD_TYPE_ICONS, recordTypeLabel } from '../lib/constants';
import { useI18n } from '../i18n';
import {
  buildVehicleMatchInputs,
  isParseReady,
  parseQuickEntry,
  RECORD_TYPES_ALL,
  type QuickEntryParseResult,
  type QuickEntryPrefill,
} from '../lib/quickEntryParse';
import {
  findNicknameCandidate,
  type QuickEntryLearnSnapshot,
} from '../lib/quickEntryLearn';
import { loadLearningBundle } from '../repositories/learning';
import {
  getSpeechRecognitionCtor,
  isSpeechRecognitionAvailable,
  type SpeechRecognitionLike,
} from '../lib/speechRecognition';
import type { CareRecord, RecordType, Station, Vehicle } from '../types';

export type QuickEntryNavState = {
  prefill: QuickEntryPrefill;
  quickEntryText?: string;
  /** Present when opened from quick-entry; used for silent local learn on save. */
  learnSnapshot?: QuickEntryLearnSnapshot;
};

type Props = {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  /** Optional records for last-used fuel/charge vehicle fallback. */
  records?: CareRecord[];
  /** Favorite / common stations for short-name matching. */
  stations?: Station[];
};

export function QuickEntrySheet({ open, onClose, vehicles, records = [], stations = [] }: Props) {
  const { t, language, isEn } = useI18n();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [speechHint, setSpeechHint] = useState('');
  const [parsed, setParsed] = useState<QuickEntryParseResult | null>(null);
  const [pickVehicleId, setPickVehicleId] = useState('');
  const [pickType, setPickType] = useState<RecordType | ''>('');
  const [err, setErr] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechOk = isSpeechRecognitionAvailable();

  useEffect(() => {
    if (!open) {
      recRef.current?.abort();
      setListening(false);
      return;
    }
    setText('');
    setParsed(null);
    setPickVehicleId('');
    setPickType('');
    setErr('');
    setSpeechHint(
      speechOk
        ? (isEn ? t('qe.hintSpeechEn') : t('qe.hintSpeech'))
        : t('qe.hintNoSpeech'),
    );
  }, [open, speechOk, isEn, t]);

  useEffect(() => {
    return () => {
      recRef.current?.abort();
    };
  }, []);

  const runParse = useCallback(
    async (utterance: string) => {
      const inputs = buildVehicleMatchInputs(vehicles, records);
      const stationInputs = stations.map((s) => ({
        id: s.id,
        name: s.name,
        stationType: s.stationType,
        brand: s.brand,
      }));
      const learning = await loadLearningBundle();
      const r = parseQuickEntry(utterance, inputs, {
        stations: stationInputs,
        learnedStationAliases: learning.stationAliases,
        learnedVehicleAliases: learning.vehicleAliases,
        amountDialect: learning.amountDialect,
      });
      setParsed(r);
      setPickVehicleId(r.vehicleId ?? '');
      setPickType(r.type ?? (r.types[0] ?? ''));
      setErr('');
      return r;
    },
    [vehicles, records, stations],
  );

  function stopListening() {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSpeechHint(t('qe.hintNoSpeechShort'));
      return;
    }
    setErr('');
    try {
      const rec = new Ctor();
      rec.lang = isEn ? 'en-US' : 'zh-CN';
      rec.continuous = false;
      rec.interimResults = true;
      if ('processLocally' in rec) {
        try {
          rec.processLocally = true;
        } catch {
          /* optional */
        }
      }
      rec.onresult = (ev) => {
        const parts: string[] = [];
        for (let i = 0; i < ev.results.length; i++) {
          parts.push(ev.results[i][0].transcript);
        }
        const transcript = parts.join('').trim();
        if (transcript) setText(transcript);
      };
      rec.onerror = (ev) => {
        setListening(false);
        if (ev.error === 'not-allowed') {
          setErr(t('qe.errMic'));
        } else if (ev.error === 'language-not-supported') {
          setErr(t('qe.errLang'));
        } else if (ev.error !== 'aborted') {
          setErr(t('qe.errSpeech', { error: ev.error }));
        }
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('qe.errStart'));
      setListening(false);
    }
  }

  async function onParseClick() {
    if (!text.trim()) {
      setErr(t('qe.errEmpty'));
      return;
    }
    await runParse(text);
  }

  function resolveVehicleId(r: QuickEntryParseResult): string | undefined {
    if (pickVehicleId) return pickVehicleId;
    if (r.vehicleId) return r.vehicleId;
    if (vehicles.length === 1) return vehicles[0].id;
    return undefined;
  }

  function resolveType(r: QuickEntryParseResult): RecordType | undefined {
    if (pickType) return pickType;
    return r.type;
  }

  async function goToForm() {
    if (!parsed && text.trim()) {
      const r = await runParse(text);
      return goWith(r);
    }
    if (!parsed) {
      setErr(t('qe.errParseFirst'));
      return;
    }
    goWith(parsed);
  }

  function goWith(r: QuickEntryParseResult) {
    const vehicleId = resolveVehicleId(r);
    const type = resolveType(r);
    if (!vehicleId) {
      setErr(t('qe.errVehicle'));
      return;
    }
    if (!type) {
      setErr(t('qe.errType'));
      return;
    }
    let pendingVehicleAlias: string | undefined;
    if (vehicleId && (!r.vehicleId || r.vehicleId !== vehicleId)) {
      pendingVehicleAlias = findNicknameCandidate(r.raw, vehicles);
    }
    const learnSnapshot: QuickEntryLearnSnapshot = {
      raw: r.raw,
      vehicleId: r.vehicleId,
      stationQuery: r.stationQuery,
      fields: { ...r.fields },
      pendingVehicleAlias,
    };
    const state: QuickEntryNavState = {
      prefill: r.fields,
      quickEntryText: r.raw,
      learnSnapshot,
    };
    onClose();
    nav(`/vehicles/${vehicleId}/records/new/${type}`, { state });
  }

  if (!open) return null;

  // Require explicit pick whenever parse did not uniquely resolve a vehicle.
  const needsVehiclePick =
    !!parsed &&
    !parsed.vehicleId &&
    (vehicles.length > 1 || parsed.vehicleIds.length !== 1);
  const needsTypePick = !!parsed && !parsed.type;
  const vehicleOptions =
    parsed && parsed.vehicleIds.length > 1
      ? vehicles.filter((v) => parsed.vehicleIds.includes(v.id))
      : vehicles;
  const typeOptions =
    parsed && parsed.types.length > 1 ? parsed.types : RECORD_TYPES_ALL;

  const readyPreview =
    parsed &&
    (isParseReady(parsed) || (pickVehicleId && pickType)) &&
    resolveVehicleId(parsed) &&
    resolveType(parsed);

  return (
    <div className="qe-overlay" role="presentation" onClick={onClose}>
      <div
        className="qe-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qe-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qe-sheet-handle" />
        <header className="qe-sheet-head">
          <h2 id="qe-title">{t('qe.title')}</h2>
          <button type="button" className="btn ghost tiny" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>
        <p className="muted small qe-hint">{speechHint}</p>

        <label className="qe-label">
          {t('qe.textVoice')}
          <div className="qe-input-row">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setParsed(null);
              }}
              rows={3}
              placeholder={isEn ? t('qe.placeholderEn') : t('qe.placeholder')}
              autoFocus
            />
            {speechOk && (
              <button
                type="button"
                className={`btn qe-mic ${listening ? 'listening' : ''}`}
                onClick={listening ? stopListening : startListening}
                aria-pressed={listening}
                title={listening ? t('qe.stop') : t('qe.mic')}
              >
                {listening ? '⏹' : '🎤'}
              </button>
            )}
          </div>
        </label>

        <div className="qe-actions">
          <button type="button" className="btn" onClick={onParseClick} disabled={!text.trim()}>
            {t('qe.parse')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={goToForm}
            disabled={!text.trim() && !parsed}
          >
            {t('qe.openForm')}
          </button>
        </div>

        {err && <p className="error">{err}</p>}

        {parsed && (
          <div className="qe-result">
            <p className="small muted">{t('qe.result')}</p>
            {(needsVehiclePick || !parsed.vehicleId) && (
              <label>
                {t('qe.vehicle')}
                <select
                  value={pickVehicleId}
                  onChange={(e) => setPickVehicleId(e.target.value)}
                >
                  <option value="">{t('common.pleaseSelect')}</option>
                  {vehicleOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.plate ? ` · ${v.plate}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!needsVehiclePick && parsed.vehicleId && (
              <p className="qe-chip-line">
                {t('qe.vehicleColon')}
                <strong>
                  {vehicles.find((v) => v.id === parsed.vehicleId)?.name ?? parsed.vehicleId}
                </strong>
              </p>
            )}

            {(needsTypePick || !parsed.type) && (
              <label>
                {t('qe.type')}
                <select
                  value={pickType}
                  onChange={(e) => setPickType(e.target.value as RecordType | '')}
                >
                  <option value="">{t('common.pleaseSelect')}</option>
                  {typeOptions.map((rt) => (
                    <option key={rt} value={rt}>
                      {RECORD_TYPE_ICONS[rt]} {recordTypeLabel(rt, language)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!needsTypePick && parsed.type && (
              <p className="qe-chip-line">
                {t('qe.typeColon')}
                <strong>
                  {RECORD_TYPE_ICONS[parsed.type]} {recordTypeLabel(parsed.type, language)}
                </strong>
              </p>
            )}

            <ul className="qe-fields small">
              {parsed.fields.date && (
                <li>{t('qe.fieldDate', { date: new Date(parsed.fields.date).toLocaleString(isEn ? 'en' : 'zh-CN') })}</li>
              )}
              {parsed.fields.amountDue != null && <li>{t('qe.fieldDue', { n: parsed.fields.amountDue })}</li>}
              {parsed.fields.amountPaid != null && <li>{t('qe.fieldPaid', { n: parsed.fields.amountPaid })}</li>}
              {parsed.fields.discount != null && <li>{t('qe.fieldDiscount', { n: parsed.fields.discount })}</li>}
              {parsed.fields.unitPrice != null && <li>{t('qe.fieldUnitPrice', { n: parsed.fields.unitPrice })}</li>}
              {parsed.fields.liters != null && <li>{t('qe.fieldLiters', { n: parsed.fields.liters })}</li>}
              {parsed.fields.kWh != null && <li>{t('qe.fieldKWh', { n: parsed.fields.kWh })}</li>}
              {parsed.fields.odometer != null && <li>{t('qe.fieldOdo', { n: parsed.fields.odometer })}</li>}
              {parsed.fields.fuelGrade && <li>{t('qe.fieldGrade', { grade: parsed.fields.fuelGrade })}</li>}
              {parsed.fields.stationName && (
                <li>
                  {t('qe.fieldStation', { name: parsed.fields.stationName })}
                  {parsed.fields.stationId ? t('qe.fieldStationMatched') : ''}
                </li>
              )}
              {parsed.fields.place && <li>{t('qe.fieldPlace', { place: parsed.fields.place })}</li>}
              {parsed.fields.parkingKind && <li>{t('qe.fieldParking', { kind: parsed.fields.parkingKind })}</li>}
            </ul>
            {readyPreview && (
              <p className="muted small">{t('qe.nextStep')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type FabProps = {
  vehicles: Vehicle[];
  records?: CareRecord[];
  stations?: Station[];
};

/** Fixed FAB above the tab bar (home). Does not scroll with the list. */
export function QuickEntryFab({ vehicles, records = [], stations = [] }: FabProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (vehicles.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="qe-fab"
        onClick={() => setOpen(true)}
        aria-label={t('qe.title')}
        title={t('qe.fabTitle')}
      >
        <span className="qe-fab-icon" aria-hidden>
          ✏️
        </span>
        <span className="qe-fab-label">{t('qe.fab')}</span>
      </button>
      <QuickEntrySheet
        open={open}
        onClose={() => setOpen(false)}
        vehicles={vehicles}
        records={records}
        stations={stations}
      />
    </>
  );
}
