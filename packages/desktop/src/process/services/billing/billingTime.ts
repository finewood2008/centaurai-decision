const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const bucketUtcMs = (timestamp: number, granularity: 'hour' | 'day' | 'month'): number => {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const localBucket =
    granularity === 'month'
      ? Date.UTC(year, month, 1)
      : granularity === 'day'
        ? Date.UTC(year, month, day)
        : Date.UTC(year, month, day, hour);

  return localBucket - SHANGHAI_OFFSET_MS;
};

export function getBillingBuckets(timestamp: number): {
  hour_bucket: number;
  day_bucket: number;
  month_bucket: number;
} {
  return {
    hour_bucket: bucketUtcMs(timestamp, 'hour'),
    day_bucket: bucketUtcMs(timestamp, 'day'),
    month_bucket: bucketUtcMs(timestamp, 'month'),
  };
}
