/**
 * useEnabledModules — Global v1. The modules the active company runs with.
 *
 * A company with a saved configuration (company_configurations, global01)
 * gets exactly what it saved, rebuilt through the engine. A company without
 * one — every company set up before Global v1, and every company on a
 * database without global01 — gets legacyConfiguration(): every module on,
 * Projects following companies.projects_enabled. Nothing changes for them.
 *
 * Gating here is navigation and routing only; RLS and the posting functions
 * stay the security boundary. So a failed read falls back to the legacy set
 * instead of locking the user out of the app.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Company } from '@/data/adapter';
import { effectiveConfiguration, legacyConfiguration, type ModuleKey } from '@/core/global-config';

export interface EnabledModules {
  /** False until the company and its configuration have loaded. */
  ready: boolean;
  /** True when the company has a saved Global configuration. */
  configured: boolean;
  modules: ModuleKey[];
  isEnabled: (key: ModuleKey) => boolean;
}

export function useEnabledModules(): EnabledModules {
  const company_id = useAuthStore((s) => s.company_id);

  // Same cached query as useCompany(); read directly so this file depends on
  // nothing in use-company-currency (which builds useProjectsEnabled on it).
  const { data: company, isLoading: companyLoading } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
    staleTime: 5 * 60 * 1000,
  });
  const { data: stored, isLoading: configLoading, isError } = useQuery({
    queryKey: ['company_configuration', company_id],
    queryFn:  () => getAdapter().companyConfiguration.get(company_id!),
    enabled:  !!company_id,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const country_code = company?.country_code ?? 'AE';
    const projects_enabled = Boolean((company as { projects_enabled?: boolean } | null)?.projects_enabled);
    const ready = !!company && !companyLoading && !configLoading;
    const row = !isError && stored ? stored : null;
    const config = row
      ? effectiveConfiguration(row, { country_code, projects_enabled })
      : legacyConfiguration({ country_code, projects_enabled });
    const modules = config.modules;
    return { ready, configured: !!row, modules, isEnabled: (k: ModuleKey) => modules.includes(k) };
  }, [company, companyLoading, configLoading, stored, isError]);
}
