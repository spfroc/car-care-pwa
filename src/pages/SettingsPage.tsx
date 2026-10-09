import { useEffect, useState } from 'react';
import {
  loadAppSettings,
  resetOcrWhitelist,
  setSetting,
  type AppSettings,
} from '../repositories/settings';
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
  documentLangFor,
  normalizeLanguage,
} from '../lib/datetime';
import type { Station } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [gas, setGas] = useState<Station[]>([]);
  const [charge, setCharge] = useState<Station[]>([]);
  const [newGrade, setNewGrade] = useState('');
  const [exportSize, setExportSize] = useState<number | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  async function refresh() {
    setSettings(await loadAppSettings());
    setGas(await listStations('gas'));
    setCharge(await listStations('charge'));
    setExportSize(await estimateExportSize(true));
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (settings?.language) {
      document.documentElement.lang = documentLangFor(settings.language);
    }
  }, [settings?.language]);

  if (!settings) return <div className="page"><p className="muted">加载中…</p></div>;

  async function saveKey(key: string, value: unknown) {
    await setSetting(key, value);
    if (key === 'language' && typeof value === 'string') {
      document.documentElement.lang = documentLangFor(value);
    }
    setMsg('已保存');
    await refresh();
  }

  async function onExport(withImages: boolean) {
    const size = await estimateExportSize(withImages);
    if (withImages && size > WARN_BYTES) {
      if (!confirm(`导出体积约 ${formatBytes(size)}，可能较大。仍要含图片导出？\n也可选择「不含图片导出」。`)) return;
    }
    const { json } = await exportData(withImages);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `car-care-export-v1${withImages ? '' : '-no-media'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('导出完成');
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const mode = importMode;
    if (mode === 'replace' && !confirm('覆盖导入将清空现有业务数据，确定？')) return;
    const r = await importData(text, mode);
    setMsg(r.message);
    await refresh();
  }

  async function addStation(stationType: 'gas' | 'charge') {
    const name = prompt(stationType === 'gas' ? '加油站名称' : '充电站名称');
    if (!name?.trim()) return;
    const t = nowISO();
    const s: Station = {
      id: uid(),
      stationType,
      name: name.trim(),
      sortOrder: (stationType === 'gas' ? gas : charge).length,
      isHome: stationType === 'charge' ? confirm('是否家充？') : undefined,
      createdAt: t,
      updatedAt: t,
    };
    await putStation(s);
    await refresh();
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>设置</h1>
      </header>
      {msg && <p className="toast">{msg}</p>}


      <section className="card">
        <h2>通用</h2>
        <label>
          语言
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
          日期显示格式
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
          时间显示格式
          <select
            value={settings.timeFormat}
            onChange={(e) => saveKey('timeFormat', e.target.value)}
          >
            {TIME_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {normalizeLanguage(settings.language) === 'en' ? o.labelEn : o.labelZh}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">日期时间选择器的月份、星期与按钮文案跟随语言；输入框展示跟随上述格式（默认 yyyy-mm-dd + 24 小时制）。</p>
      </section>

      <section className="card">
        <h2>燃油</h2>
        <label>
          默认燃油
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
                  if (!next.length) return alert('至少保留一个标号');
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
          <input placeholder="新标号" value={newGrade} onChange={(e) => setNewGrade(e.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              if (!newGrade.trim()) return;
              await saveKey('fuelGrades', [...settings.fuelGrades, newGrade.trim()]);
              setNewGrade('');
            }}
          >
            添加
          </button>
        </div>
      </section>

      <section className="card">
        <h2>能耗与折算</h2>
        <label>
          油耗显示单位
          <select
            value={settings.fuelEconomyUnit}
            onChange={(e) => saveKey('fuelEconomyUnit', e.target.value)}
          >
            <option value="L/100km">L/100km</option>
            <option value="km/L">km/L</option>
          </select>
        </label>
        <label>
          电耗显示单位
          <select
            value={settings.electricEconomyUnit}
            onChange={(e) => saveKey('electricEconomyUnit', e.target.value)}
          >
            <option value="kWh/100km">kWh/100km</option>
            <option value="km/kWh">km/kWh</option>
          </select>
        </label>
        <label>
          电油折算系数 (L/kWh)
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
          HEV 允许录充电（默认关闭）
        </label>
      </section>


      <section className="card">
        <h2>安装到主屏幕</h2>
        <p className="hint">
          已安装时（独立窗口 / 无浏览器地址栏）会显示「已安装」提示。未安装时可在首页顶部横幅点「安装」或「怎么装」。
        </p>
        <button type="button" className="btn block" onClick={() => setInstallGuideOpen((v) => !v)}>
          {installGuideOpen ? '收起安装说明' : '查看安装说明'}
        </button>
        {installGuideOpen && (
          <div className="muted small" style={{ marginTop: 10 }}>
            <p><strong>iOS Safari：</strong>分享 → 添加到主屏幕。</p>
            <p><strong>Android Chrome：</strong>菜单 ⋮ → 安装应用 / 添加到主屏幕。若「已安装」但桌面无图标，检查 Chrome 的桌面快捷方式权限；应用抽屉里也可能有图标。</p>
            <p><strong>国产浏览器 / 无 GMS：</strong>多为「添加到主屏幕」快捷方式，不一定有 WebAPK；勿用微信内置浏览器安装。</p>
            <p>技术说明见仓库 <code>docs/pwa-install.md</code>。</p>
          </div>
        )}
      </section>

      <section className="card ocr-card">
        <h2>OCR 识别白名单</h2>
        <p className="hint">更改将在下一次 OCR 识别时生效。识别仅本地/浏览器，无云 OCR。</p>
        {(
          [
            ['main', '主要识别白名单', settings.ocrMain],
            ['date', '日期识别白名单', settings.ocrDate],
            ['amountDue', '应付金额识别白名单', settings.ocrAmountDue],
            ['discount', '优惠金额识别白名单', settings.ocrDiscount],
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
                  setMsg(`${label}已重置`);
                  refresh();
                }}
              >
                重置
              </button>
            </div>
            <textarea
              rows={3}
              defaultValue={value}
              key={value}
              onBlur={(e) => saveKey(`ocrWhitelist.${field}`, e.target.value)}
            />
            <p className="hint tiny">下次识别时生效</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>收藏加油站</h2>
        <ul className="simple-list">
          {gas.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <button type="button" className="btn ghost danger-text" onClick={() => deleteStation(s.id).then(refresh)}>
                删
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => addStation('gas')}>
          + 加油站
        </button>
      </section>

      <section className="card">
        <h2>收藏充电站</h2>
        <ul className="simple-list">
          {charge.map((s) => (
            <li key={s.id}>
              <span>
                {s.name}
                {s.isHome ? ' · 家充' : ''}
              </span>
              <button type="button" className="btn ghost danger-text" onClick={() => deleteStation(s.id).then(refresh)}>
                删
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => addStation('charge')}>
          + 充电站
        </button>
      </section>

      <section className="card">
        <h2>快捷识别</h2>
        <p className="muted small">
          识别会记住你的纠正（仅本机）。从快捷记账预填并保存后，站点简称、车辆别名与「N块+优惠」口径会写入本地学习库，不会上传；导出/导入 JSON 可一并备份。
        </p>
      </section>

      <section className="card">
        <h2>数据</h2>
        {exportSize != null && (
          <p className="muted small">
            含图导出约 {formatBytes(exportSize)}
            {exportSize > WARN_BYTES ? '（体积较大，建议注意）' : ''}
          </p>
        )}
        <button type="button" className="btn block" onClick={() => onExport(true)}>
          导出 JSON（含图片）
        </button>
        <button type="button" className="btn block" onClick={() => onExport(false)}>
          导出 JSON（不含图片）
        </button>
        <label>
          导入模式（默认合并去重）
          <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">合并去重</option>
            <option value="replace">完全覆盖</option>
          </select>
        </label>
        <label className="btn block file-btn">
          导入 JSON
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
            if (!confirm('载入演示数据将清空现有业务数据并写入种子包，确定？')) return;
            await loadDemoSeed(true);
            setMsg('演示数据已载入');
            await refresh();
          }}
        >
          载入演示数据
        </button>
        <button
          type="button"
          className="btn danger block"
          onClick={async () => {
            if (!confirm('清空全部车辆与记录？')) return;
            if (!confirm('再次确认清空')) return;
            await clearAllData();
            setMsg('已清空');
            await refresh();
          }}
        >
          清空数据
        </button>
      </section>

      <section className="card muted small">
        <p>语言 {settings.language} · 日期 {settings.dateFormat} · 时间 {settings.timeFormat} · 货币 {settings.currency.symbol}</p>
        <p>OCR 引擎属 M2；当前仅保存白名单配置。</p>
      </section>
    </div>
  );
}
