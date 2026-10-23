import { isPossibleCode } from '../domain/alias.js';
import { decodeStatsKey, startOfUtcDay, STATS_DIMENSIONS, type StatsDimension } from '../domain/daily-stats.js';
import { NotFoundError } from '../errors.js';
import type { LinkRepository } from '../repositories/link.repository.js';
import type { StatsRepository } from '../repositories/stats.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LinkStats {
  code: string;
  from: string;
  to: string;
  totalClicks: number;
  /** One entry per day in the range, including days with zero clicks (charts need them). */
  daily: { date: string; clicks: number }[];
  breakdowns: Record<StatsDimension, { key: string; count: number }[]>;
}

export class StatsService {
  constructor(
    private readonly links: LinkRepository,
    private readonly stats: StatsRepository,
  ) {}

  /** Stats for the last `days` days, today included (UTC). */
  async getStats(code: string, days: number): Promise<LinkStats> {
    const link = isPossibleCode(code) ? await this.links.findByCode(code) : null;
    if (!link) {
      throw new NotFoundError();
    }

    const today = startOfUtcDay(new Date());
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);
    const result = await this.stats.aggregate(code, from);

    // The aggregation only returns days that had clicks; fill in the gaps.
    const clicksByDate = new Map(result.daily.map((entry) => [toDateString(entry.day), entry.clicks]));
    const daily = [];
    for (let time = from.getTime(); time <= today.getTime(); time += DAY_MS) {
      const date = toDateString(new Date(time));
      daily.push({ date, clicks: clicksByDate.get(date) ?? 0 });
    }

    const breakdowns = {} as LinkStats['breakdowns'];
    for (const dimension of STATS_DIMENSIONS) {
      breakdowns[dimension] = result[dimension].map(({ key, count }) => ({ key: decodeStatsKey(key), count }));
    }

    return {
      code,
      from: toDateString(from),
      to: toDateString(today),
      totalClicks: daily.reduce((sum, entry) => sum + entry.clicks, 0),
      daily,
      breakdowns,
    };
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10); // "2026-10-23"
}
