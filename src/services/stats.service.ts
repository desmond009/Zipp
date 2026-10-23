import { toLiveClick, type LiveClick } from '../domain/click-event.js';
import { decodeStatsKey, startOfUtcDay, STATS_DIMENSIONS, type StatsDimension } from '../domain/daily-stats.js';
import type { ClickRepository } from '../repositories/click.repository.js';
import type { StatsRepository } from '../repositories/stats.repository.js';
import type { LinkService, LinkView } from './link.service.js';
import type { AuthUser } from './session-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_CLICKS = 20;

export interface LinkStats {
  link: LinkView;
  from: string;
  to: string;
  totalClicks: number;
  /** Clicks in the same-length period just before `from`, for "+15% vs previous 7d". */
  previousTotalClicks: number;
  uniqueVisitors: number;
  /** One entry per day in the range, including days with zero clicks (charts need them). */
  daily: { date: string; clicks: number }[];
  breakdowns: Record<StatsDimension, { key: string; count: number }[]>;
}

export class StatsService {
  constructor(
    private readonly linkService: LinkService,
    private readonly stats: StatsRepository,
    private readonly clicks: ClickRepository,
  ) {}

  /** Stats for the last `days` days, today included (UTC). */
  async getStats(code: string, days: number, viewer: AuthUser | null): Promise<LinkStats> {
    const link = await this.linkService.getViewableLink(code, viewer);

    const today = startOfUtcDay(new Date());
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);
    const previousFrom = new Date(from.getTime() - days * DAY_MS);

    // Independent queries, so run them at the same time.
    const [result, previousTotalClicks, uniqueVisitors] = await Promise.all([
      this.stats.aggregate(code, from),
      this.stats.totalClicks(code, previousFrom, from),
      this.clicks.countUniqueVisitors(code, from),
    ]);

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
      link: this.linkService.toView(link),
      from: toDateString(from),
      to: toDateString(today),
      totalClicks: daily.reduce((sum, entry) => sum + entry.clicks, 0),
      previousTotalClicks,
      uniqueVisitors,
      daily,
      breakdowns,
    };
  }

  /** Latest clicks, oldest first, after checking the viewer may see them. */
  async getRecentClicks(code: string, viewer: AuthUser | null): Promise<LiveClick[]> {
    await this.linkService.getViewableLink(code, viewer);
    const recent = await this.clicks.findRecent(code, RECENT_CLICKS);
    return recent.reverse().map(toLiveClick);
  }
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10); // "2026-10-23"
}
