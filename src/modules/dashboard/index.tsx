import { useTranslation } from 'react-i18next';

export default function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 text-4xl">⚡</div>
      <h1 className="mb-2 text-2xl font-bold text-ink-primary">{t('dashboard.title')}</h1>
      <p className="text-ink-secondary">{t('dashboard.phase_note')}</p>
    </div>
  );
}
