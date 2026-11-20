/**
 * Rules and thresholds. The About page and the README read from here, so change them in one place.
 */
import type { ChangeType } from './model';

export const rules = {
  /** A pending ack on an at-risk-eligible notice turns it at_risk this many days (or fewer) before the effective date. */
  atRiskDays: 7,
  /**
   * Change types that can be at_risk. Spec rule 4 names breaking changes only, so that is the default; additive changes
   * are never at risk (rule 5). Add 'deprecation' here to treat deprecations like breaking changes.
   */
  atRiskTypes: ['breaking'] as ChangeType[],
  /** The dashboard chart covers open notices effective within this many days (plus any already overdue). */
  dashboardHorizonDays: 30,
  /** Live screens (inbox, notice detail, dashboard) refresh this often while the tab is visible. */
  pollMs: 5000,
} as const;
