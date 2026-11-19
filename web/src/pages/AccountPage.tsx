import { useState, type FormEvent, type ReactElement } from 'react';
import { api, ApiError, describeError, type ConfigSummary, type License } from '../api';
import { useI18n } from '../i18n';
import { LicensesTable } from './LicensesPage';
import { useAuthed } from './useAuthed';

const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** What the server accepts as a config (src/modules/configs/configs.schemas.ts). */
const EXAMPLE = {
  sensitivity: 0.7,
  resolution: { width: 1920, height: 1080 },
  smoothing: { algorithm: 'ema', strength: 0.3 },
  fpsLimit: 144,
};

function saveFile(name: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Name suggested from the file: "My Profile (2).json" → "My-Profile-2". */
function nameFromFile(file: string): string {
  return file
    .replace(/\.json$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

interface Loaded {
  licenses: License[];
  configs: ConfigSummary[];
}

/**
 * The page after sign-in: upload a .json config under a name, see and manage saved configs, see
 * purchased licenses. Configs are validated by the server; its field errors are shown as is.
 */
export function AccountPage(): ReactElement {
  const { t, formatDate } = useI18n();
  const { data, error, reload } = useAuthed<Loaded>(async () => {
    const [licenses, configs] = await Promise.all([api.licenses(), api.configs()]);
    return { licenses, configs };
  });

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const upload = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (file === null) return;
    setBusy(true);
    setFailure(null);
    setProblem(null);
    setSaved(null);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        setProblem(t.account.badJson);
        return;
      }
      await api.saveConfig(name, payload);
      setSaved(name);
      setFile(null);
      setName('');
      (event.target as HTMLFormElement).reset();
      reload();
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (configName: string): Promise<void> => {
    try {
      await api.deleteConfig(configName);
      reload();
    } catch (e) {
      setFailure(e);
    }
  };

  const download = async (configName: string): Promise<void> => {
    try {
      saveFile(configName, (await api.config(configName)).payload);
    } catch (e) {
      setFailure(e);
    }
  };

  const details = failure instanceof ApiError ? failure.details : [];
  const uploadError = problem ?? (failure === null ? null : describeError(failure, t.errors));

  return (
    <div className="account">
      <h1>{t.account.title}</h1>
      {import.meta.env.DEV && <p className="muted dev-note">{t.account.testCode}</p>}
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>{t.account.configsTitle}</h2>
        <p className="muted">{t.account.configsLead}</p>
        <form className="form config-form" onSubmit={(e) => void upload(e)}>
          <label>
            {t.account.file}
            <input
              type="file"
              accept=".json,application/json"
              required
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && name === '') setName(nameFromFile(picked.name));
              }}
            />
          </label>
          <label>
            {t.account.name}
            <input
              value={name}
              required
              maxLength={64}
              pattern="[A-Za-z0-9_\-]{1,64}"
              placeholder={t.account.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
            <small className="muted">{t.account.nameHint}</small>
          </label>
          {uploadError && (
            <div className="error" role="alert">
              <p>{uploadError}</p>
              {details.length > 0 && (
                <ul>
                  {details.map((d) => (
                    <li key={`${d.path}:${d.message}`}>
                      <code>{d.path || '—'}</code>: {d.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {saved && <p className="ok">{t.account.saved(saved)}</p>}
          <div className="row">
            <button
              type="submit"
              className="button"
              disabled={busy || file === null || !NAME.test(name)}
            >
              {busy ? t.account.uploading : t.account.upload}
            </button>
            <button type="button" className="link" onClick={() => saveFile('example', EXAMPLE)}>
              {t.account.example}
            </button>
          </div>
        </form>

        {data && data.configs.length === 0 && <p className="muted">{t.account.noConfigs}</p>}
        {data && data.configs.length > 0 && (
          <ul className="config-list">
            {data.configs.map((c) => (
              <li key={c.name}>
                <span>
                  <code>{c.name}</code>{' '}
                  <span className="muted">
                    · {t.account.updated} {formatDate(c.updatedAt)}
                  </span>
                </span>
                <span className="row">
                  <button type="button" className="link" onClick={() => void download(c.name)}>
                    {t.account.download}
                  </button>
                  <button type="button" className="link danger" onClick={() => void remove(c.name)}>
                    {t.account.remove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>{t.licenses.title}</h2>
        {data === null && !error && <p className="muted">{t.loading}</p>}
        {data && <LicensesTable licenses={data.licenses} />}
      </section>
    </div>
  );
}
