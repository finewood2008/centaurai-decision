type RetentionRepo = {
  getSettings(): { detail_retention_days: number };
  deleteEventsOlderThan(cutoff: number): number;
};

export function runBillingRetention(repo: RetentionRepo, now = Date.now()): number {
  const days = repo.getSettings().detail_retention_days;
  return repo.deleteEventsOlderThan(now - days * 24 * 60 * 60 * 1000);
}
