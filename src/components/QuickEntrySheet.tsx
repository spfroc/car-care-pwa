import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RECORD_TYPE_ICONS, RECORD_TYPE_LABELS } from '../lib/constants';
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
        ? '可点麦克风说中文，或直接打字。识别后仅预填表单，不会自动保存。'
        : '当前浏览器不支持语音识别，请打字输入。识别后仅预填表单，不会自动保存。',
    );
  }, [open, speechOk]);

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
      setPickVehicleId(r.vehicleId ?? (r.vehicleIds[0] ?? ''));
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
      setSpeechHint('当前浏览器不支持语音识别，请打字输入。');
      return;
    }
    setErr('');
    try {
      const rec = new Ctor();
      rec.lang = 'zh-CN';
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
        const t = parts.join('').trim();
        if (t) setText(t);
      };
      rec.onerror = (ev) => {
        setListening(false);
        if (ev.error === 'not-allowed') {
          setErr('未获得麦克风权限');
        } else if (ev.error === 'language-not-supported') {
          setErr('不支持 zh-CN 语音识别，请改用文字');
        } else if (ev.error !== 'aborted') {
          setErr(`语音识别失败：${ev.error}`);
        }
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '无法启动语音识别');
      setListening(false);
    }
  }

  async function onParseClick() {
    if (!text.trim()) {
      setErr('请先输入或语音录入内容');
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
      setErr('请先识别内容');
      return;
    }
    goWith(parsed);
  }

  function goWith(r: QuickEntryParseResult) {
    const vehicleId = resolveVehicleId(r);
    const type = resolveType(r);
    if (!vehicleId) {
      setErr('请选择车辆');
      return;
    }
    if (!type) {
      setErr('请选择记录类型');
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

  const needsVehiclePick =
    !!parsed &&
    !parsed.vehicleId &&
    (parsed.vehicleIds.length !== 1 || vehicles.length > 1);
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
          <h2 id="qe-title">快捷记账</h2>
          <button type="button" className="btn ghost tiny" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <p className="muted small qe-hint">{speechHint}</p>

        <label className="qe-label">
          文字 / 语音
          <div className="qe-input-row">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setParsed(null);
              }}
              rows={3}
              placeholder="例：X-RV 加油 40 升 320 元 里程 12345"
              autoFocus
            />
            {speechOk && (
              <button
                type="button"
                className={`btn qe-mic ${listening ? 'listening' : ''}`}
                onClick={listening ? stopListening : startListening}
                aria-pressed={listening}
                title={listening ? '停止' : '语音输入'}
              >
                {listening ? '⏹' : '🎤'}
              </button>
            )}
          </div>
        </label>

        <div className="qe-actions">
          <button type="button" className="btn" onClick={onParseClick} disabled={!text.trim()}>
            识别
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={goToForm}
            disabled={!text.trim() && !parsed}
          >
            预填并打开表单
          </button>
        </div>

        {err && <p className="error">{err}</p>}

        {parsed && (
          <div className="qe-result">
            <p className="small muted">解析结果（可改选后打开表单）</p>
            {(needsVehiclePick || !parsed.vehicleId) && (
              <label>
                车辆
                <select
                  value={pickVehicleId}
                  onChange={(e) => setPickVehicleId(e.target.value)}
                >
                  <option value="">请选择</option>
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
                车辆：
                <strong>
                  {vehicles.find((v) => v.id === parsed.vehicleId)?.name ?? parsed.vehicleId}
                </strong>
              </p>
            )}

            {(needsTypePick || !parsed.type) && (
              <label>
                类型
                <select
                  value={pickType}
                  onChange={(e) => setPickType(e.target.value as RecordType | '')}
                >
                  <option value="">请选择</option>
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {RECORD_TYPE_ICONS[t]} {RECORD_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!needsTypePick && parsed.type && (
              <p className="qe-chip-line">
                类型：
                <strong>
                  {RECORD_TYPE_ICONS[parsed.type]} {RECORD_TYPE_LABELS[parsed.type]}
                </strong>
              </p>
            )}

            <ul className="qe-fields small">
              {parsed.fields.date && (
                <li>日期 {new Date(parsed.fields.date).toLocaleString('zh-CN')}</li>
              )}
              {parsed.fields.amountDue != null && <li>应付 ¥{parsed.fields.amountDue}</li>}
              {parsed.fields.amountPaid != null && <li>实付 ¥{parsed.fields.amountPaid}</li>}
              {parsed.fields.discount != null && <li>优惠 ¥{parsed.fields.discount}</li>}
              {parsed.fields.unitPrice != null && <li>单价 ¥{parsed.fields.unitPrice}/L</li>}
              {parsed.fields.liters != null && <li>加油 {parsed.fields.liters} L</li>}
              {parsed.fields.kWh != null && <li>充电 {parsed.fields.kWh} kWh</li>}
              {parsed.fields.odometer != null && <li>里程 {parsed.fields.odometer}</li>}
              {parsed.fields.fuelGrade && <li>标号 {parsed.fields.fuelGrade}</li>}
              {parsed.fields.stationName && (
                <li>
                  站点 {parsed.fields.stationName}
                  {parsed.fields.stationId ? '（已匹配收藏）' : ''}
                </li>
              )}
              {parsed.fields.place && <li>地点 {parsed.fields.place}</li>}
              {parsed.fields.parkingKind && <li>停车 {parsed.fields.parkingKind}</li>}
            </ul>
            {readyPreview && (
              <p className="muted small">下一步打开表单，请确认后再保存。</p>
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
  const [open, setOpen] = useState(false);
  if (vehicles.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="qe-fab"
        onClick={() => setOpen(true)}
        aria-label="快捷记账"
        title="文字/语音快捷记账"
      >
        <span className="qe-fab-icon" aria-hidden>
          ✏️
        </span>
        <span className="qe-fab-label">快捷</span>
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
