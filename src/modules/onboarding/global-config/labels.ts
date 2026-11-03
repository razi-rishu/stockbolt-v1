/**
 * Literal translation keys for engine codes. Kept as a map rather than built
 * with template strings, so every key is greppable and the i18n coverage test
 * can see it.
 */
import type { ComplianceLevel, ConfigIssueCode } from '@/core/global-config';

export const ISSUE_KEY: Record<ConfigIssueCode, string> = {
  no_activities: 'global_config.issue.no_activities',
  too_many_activities: 'global_config.issue.too_many_activities',
  unknown_activity: 'global_config.issue.unknown_activity',
  duplicate_activity: 'global_config.issue.duplicate_activity',
  primary_not_selected: 'global_config.issue.primary_not_selected',
  unknown_module: 'global_config.issue.unknown_module',
  essential_module: 'global_config.issue.essential_module',
  required_by: 'global_config.issue.required_by',
  not_available_in_country: 'global_config.issue.not_available_in_country',
  country_not_activatable: 'global_config.issue.country_not_activatable',
};

export const COMPLIANCE_KEY: Record<ComplianceLevel, string> = {
  statutory: 'global_config.compliance_statutory',
  tax_configuration: 'global_config.compliance_tax_configuration',
  generic: 'global_config.compliance_generic',
};
