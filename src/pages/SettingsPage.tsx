import { useState } from 'react';
import { resetOcrWhitelist } from '../repositories/settings';
import { deleteStation, listStations, putStation } from '../repositories/stations';
import {
  WARN_BYTES,
  clearAllData,
  estimateExportSize,
  exportData,
  formatBytes,
  importData,
} from '../repositories/importExport';
import { loadDemoSeed } from '../seed/demo';
import { nowISO, uid } from '../lib/constants';
import {
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  TIME_FORMAT_OPTIONS,
  normalizeLanguage,
} from '../lib/datetime';
import { useSettings } from '../hooks/useAppData';
import type { Station } from '../types';
import { useEffect } from 'react';
import { DataStorageSettings } from '../components/DataStorageSettings';

export function SettingsPage() {
  const { settings, saveSetting, refresh, t, language } = useSettings();
  const [msg, setMsg] = useState('');
  const [gas, setGas] = useState<Station[]>([]);
  const [charge, setCharge] = useState<Station[]>([]);
  const [newGrade, setNewGrade] = useState('');
  const [exportSize, setExportSize] = useState<number | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [skipCorruptMedia, setSkipCorruptMedia] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  async function refreshLocal() {
    await refresh();
    setGas(await listStations('gas'));
    setCharge(await listStations('charge'));
    setExportSize(await estimateExportSize(true));
  }

  useEffect(() => {
    refreshLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!settings) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  async function saveKey(key: string, value: unknown) {
    await saveSetting(key, value);
    setMsg(t('common.saved'));
    setGas(await listStations('gas'));
    setCharge(await listStations('charge'));
    setExportSize(await estimateExportSize(true));
  }

  async function onExport(withImages: boolean) {
    const size = await estimateExportSize(withImages);
    if (withImages && size > WARN_BYTES) {
      if (!confirm(t('settings.exportWarn', { size: formatBytes(size) }))) return;
    }
    const { json } = await exportData(withImages);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `car-care-export-v1${withImages ? '' : '-no-media'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(t('settings.exportDone'));
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const mode = importMode;
    if (mode === 'replace' && !confirm(t('settings.importReplaceConfirm'))) return;
    const r = await importData(text, mode, { skipCorruptMedia });
    setMsg(r.message);
    await refreshLocal();
  }

  async function addStation(stationType: 'gas' | 'charge') {
    const name = prompt(stationType === 'gas' ? t('settings.promptGas') : t('settings.promptCharge'));
    if (!name?.trim()) return;
    const ts = nowISO();
    const s: Station = {
      id: uid(),
      stationType,
      name: name.trim(),
      sortOrder: (stationType === 'gas' ? gas : charge).length,
      isHome: stationType === 'charge' ? confirm(t('settings.promptHomeCharge')) : undefined,
      createdAt: ts,
      updatedAt: ts,
    };
    await putStation(s);
    await refreshLocal();
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
      </header>
      {msg && <p className="toast">{msg}</p>}

      <section className="card">
        <h2>{t('settings.general')}</h2>
        <label>
          {t('settings.language')}
          <select
            value={normalizeLanguage(settings.language)}
            onChange={(e) => saveKey('language', e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.dateFormat')}
          <select
            value={settings.dateFormat}
            onChange={(e) => saveKey('dateFormat', e.target.value)}
          >
            {DATE_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.timeFormat')}
          <select
            value={settings.timeFormat}
            onChange={(e) => saveKey('timeFormat', e.target.value)}
          >
            {TIME_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {language === 'en' ? o.labelEn : o.labelZh}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">{t('settings.datetimeHint')}</p>
      </section>

      <section className="card">
        <h2>{t('settings.fuel')}</h2>
        <label>
          {t('settings.defaultFuel')}
          <select
            value={settings.defaultFuelGrade}
            onChange={(e) => saveKey('defaultFuelGrade', e.target.value)}
          >
            {settings.fuelGrades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <div className="chip-row">
          {settings.fuelGrades.map((g) => (
            <span key={g} className="chip">
              {g}
              <button
                type="button"
                className="chip-x"
                onClick={async () => {
                  const next = settings.fuelGrades.filter((x) => x !== g);
                  if (!next.length) return alert(t('settings.keepOneGrade'));
                  await saveKey('fuelGrades', next);
                  if (settings.defaultFuelGrade === g) await saveKey('defaultFuelGrade', next[0]);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row">
          <input placeholder={t('settings.newGrade')} value={newGrade} onChange={(e) => setNewGrade(e.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (!newGrade.trim()) return;
              await saveKey('fuelGrades', [...settings.fuelGrades, newGrade.trim()]);
              setNewGrade('');
            }}
          >
            {t('common.add')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>{t('settings.economy')}</h2>
        <label>
          {t('settings.fuelEcoUnit')}
          <select
            value={settings.fuelEconomyUnit}
            onChange={(e) => saveKey('fuelEconomyUnit', e.target.value)}
          >
            <option value="L/100km">L/100km</option>
            <option value="km/L">km/L</option>
          </select>
        </label>
        <label>
          {t('settings.elecEcoUnit')}
          <select
            value={settings.electricEconomyUnit}
            onChange={(e) => saveKey('electricEconomyUnit', e.target.value)}
          >
            <option value="kWh/100km">kWh/100km</option>
            <option value="km/kWh">km/kWh</option>
          </select>
        </label>
        <label>
          {t('settings.kwhFactor')}
          <input
            type="number"
            step="0.001"
            defaultValue={settings.kwhToLiterFactor}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n) && n > 0) saveKey('kwhToLiterFactor', n);
            }}
          />
        </label>
        <label className="row-check">
          <input
            type="checkbox"
            checked={settings.hevAllowCharge}
            onChange={(e) => saveKey('hevAllowCharge', e.target.checked)}
          />
          {t('settings.hevCharge')}
        </label>
      </section>

      <section className="card">
        <h2>{t('settings.install')}</h2>
        <p className="hint">{t('settings.installHint')}</p>
        <button type="button" className="btn block" onClick={() => setInstallGuideOpen((v) => !v)}>
          {installGuideOpen ? t('settings.installToggleOpen') : t('settings.installToggleClosed')}
        </button>
        {installGuideOpen && (
          <div className="muted small" style={{ marginTop: 10 }}>
            <p><strong>{t('settings.installIos')}</strong></p>
            <p><strong>{t('settings.installAndroid')}</strong></p>
            <p><strong>{t('settings.installCn')}</strong></p>
            <p>{t('settings.installDocs')}</p>
          </div>
        )}
      </section>

      <section className="card ocr-card">
        <h2>{t('settings.ocr')}</h2>
        <p className="hint">{t('settings.ocrHint')}</p>
        {(
          [
            ['main', t('settings.ocrMain'), settings.ocrMain],
            ['date', t('settings.ocrDate'), settings.ocrDate],
            ['amountDue', t('settings.ocrAmountDue'), settings.ocrAmountDue],
            ['discount', t('settings.ocrDiscount'), settings.ocrDiscount],
          ] as const
        ).map(([field, label, value]) => (
          <div key={field} className="ocr-field">
            <div className="ocr-field-head">
              <span>{label}</span>
              <button
                type="button"
                className="btn ghost tiny"
                onClick={async () => {
                  await resetOcrWhitelist(field);
                  setMsg(t('settings.resetDone', { label }));
                  refreshLocal();
                }}
              >
                {t('settings.reset')}
              </button>
            </div>
            <textarea
              rows={3}
              defaultValue={value}
              key={value}
              onBlur={(e) => saveKey(`ocrWhitelist.${field}`, e.target.value)}
            />
            <p className="hint tiny">{t('settings.nextOcr')}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{t('settings.gasStations')}</h2>
        <ul className="simple-list">
          {gas.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <button type="button" className="btn ghost danger-text" onClick={() => deleteStation(s.id).then(refreshLocal)}>
                {t('settings.deleteShort')}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => addStation('gas')}>
          {t('settings.addGas')}
        </button>
      </section>

      <section className="card">
        <h2>{t('settings.chargeStations')}</h2>
        <ul className="simple-list">
          {charge.map((s) => (
            <li key={s.id}>
              <span>
                {s.name}
                {s.isHome ? t('settings.homeCharge') : ''}
              </span>
              <button type="button" className="btn ghost danger-text" onClick={() => deleteStation(s.id).then(refreshLocal)}>
                {t('settings.deleteShort')}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => addStation('charge')}>
          {t('settings.addCharge')}
        </button>
      </section>

      <section className="card">
        <h2>{t('settings.quickLearn')}</h2>
        <p className="muted small">{t('settings.quickLearnHint')}</p>
      </section>

      <DataStorageSettings />

      <section className="card">
        <h2>{t('settings.data')}</h2>
        {exportSize != null && (
          <p className="muted small">
            {t('settings.exportSize', { size: formatBytes(exportSize) })}
            {exportSize > WARN_BYTES ? t('settings.exportSizeWarn') : ''}
          </p>
        )}
        <button type="button" className="btn block" onClick={() => onExport(true)}>
          {t('settings.exportWithMedia')}
        </button>
        <button type="button" className="btn block" onClick={() => onExport(false)}>
          {t('settings.exportNoMedia')}
        </button>
        <label>
          {t('settings.importMode')}
          <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">{t('settings.importMerge')}</option>
            <option value="replace">{t('settings.importReplace')}</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={skipCorruptMedia}
            onChange={(e) => setSkipCorruptMedia(e.target.checked)}
          />
          {t('settings.skipCorruptMedia')}
        </label>
        <p className="muted small">{t('settings.skipCorruptMediaHint')}</p>
        <label className="btn block file-btn">
          {t('settings.import')}
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="btn primary block"
          onClick={async () => {
            if (!confirm(t('settings.loadDemoConfirm'))) return;
            await loadDemoSeed(true);
            setMsg(t('settings.loadDemoDone'));
            await refreshLocal();
          }}
        >
          {t('settings.loadDemo')}
        </button>
        <button
          type="button"
          className="btn danger block"
          onClick={async () => {
            if (!confirm(t('settings.clearConfirm1'))) return;
            if (!confirm(t('settings.clearConfirm2'))) return;
            await clearAllData();
            setMsg(t('settings.clearDone'));
            await refreshLocal();
          }}
        >
          {t('settings.clearData')}
        </button>
      </section>

      <section className="card muted small">
        <p>
          {t('settings.footerLang', {
            language: settings.language,
            dateFormat: settings.dateFormat,
            timeFormat: settings.timeFormat,
            currency: settings.currency.symbol,
          })}
        </p>
        <p>{t('settings.footerOcr')}</p>
      </section>
    </div>
  );
}
