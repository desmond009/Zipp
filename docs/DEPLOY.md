# Deploying Zipp for free

Zipp runs on three free tiers:

| Piece | Service | Free tier |
|---|---|---|
| API + analytics worker + web app | [Render](https://render.com) web service | 512 MB RAM; sleeps after 15 min without traffic |
| MongoDB | [MongoDB Atlas](https://www.mongodb.com/atlas) free cluster | 512 MB storage, 100 ops/s |
| Redis | [Redis Cloud](https://redis.io/cloud/) free database | 30 MB, 30 connections, 100 ops/s |

**Why these choices**

- Render's free tier has no background workers, so one service runs both the API and the worker ([`src/start-all.ts`](../src/start-all.ts)). In production they would be separate services.
- Redis Cloud rather than Upstash: Upstash's free tier counts every command (500K per month), and the worker's blocking reads alone would use about 1.5M a month while idle. Redis Cloud has no monthly command quota.

Everything Render needs is in [`render.yaml`](../render.yaml). You only supply the two database connection strings. It takes about 20 minutes.

## 1. MongoDB Atlas

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a **free cluster**. Pick a region close to Render's region (e.g. AWS `us-east-1` if Render is in Ohio, or a Frankfurt/EU region for both).
2. **Database user:** create a user with a long, generated password and the **Read and write to any database** role.
3. **Network access:** add `0.0.0.0/0` (allow from anywhere). Render's free tier has no fixed outgoing IP address, so there is nothing narrower to allow. This makes the strong password your main protection: keep it long and random.
4. **Connect → Drivers:** copy the connection string. It looks like:
   ```
   mongodb+srv://zipp:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
   ```
   Put your password in place of `<password>`. If the password contains characters like `@ : / ? #`, [URL-encode them](https://www.urlencoder.org/), or generate one with only letters and digits.

You don't need to create a database or collections: Zipp creates the `zipp` database, its collections and its indexes on startup.

## 2. Redis Cloud

1. Sign up at [redis.io/cloud](https://redis.io/cloud/) and create a **free** database (30 MB) in the same region.
2. In the database's **Configuration**, set the **data eviction policy** to `volatile-lru`. When memory is full, Redis then evicts only keys that have an expiry (cache entries, rate-limit windows), never the queue of unprocessed clicks.
3. Copy the **public endpoint** (`host:port`) and the **default user's password**, and build:
   ```
   redis://default:<password>@<host>:<port>
   ```
   If the dashboard says TLS is required, use `rediss://` (two s's) instead.

## 3. Render

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. **New → Blueprint**, pick the `Zipp` repository. Render reads `render.yaml` and shows one service, `zipp`.
3. It asks for the two values marked `sync: false`:
   - `MONGO_URI`: the Atlas string from step 1
   - `REDIS_URL`: the Redis string from step 2
4. **Apply.** The first build takes a few minutes. Your app is then live at `https://zipp-<something>.onrender.com`. That address is shown in the dashboard, and Zipp uses it for short links automatically.

**Everything else is set by `render.yaml`:**

- `TRUST_PROXY=true`, so per-IP rate limits see real client IPs behind Render's proxy.
- A random `IP_HASH_SECRET`, generated once by Render.
- A smaller click-stream cap (50,000 events) to fit in 30 MB.
- A memory limit so both Node processes fit in 512 MB. In a production-like test they used about 240 MB together.
- Automatic deploys after GitHub Actions passes on each push to `main`.

## 4. Check it works

```bash
APP=https://zipp-<something>.onrender.com
curl -s $APP/health        # {"status":"ok","checks":{"mongo":"up","redis":"up"}}
curl -s -X POST $APP/api/shorten -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
```

Then open the app in a browser, register, shorten a link, open it in another tab, and watch it appear in the stats page's live tail.

## What to expect on free tiers

- **Cold starts:** after 15 minutes without traffic Render stops the service, and the next request takes about a minute while it starts. Clicks only happen while it's awake, so none are lost, and links and stats are kept in Atlas and Redis.
- **Don't load-test the deployed app.** The 100 ops/s database limits are far below what [the load tests](../README.md#load-testing) push. Those numbers come from the local Docker setup.
- **No country data** unless you add a GeoLite2 database. Its license doesn't allow committing it to a public repository; countries show as `unknown`.
- **Monthly hours:** Render gives 750 free hours a month, enough for one service running non-stop.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Deploy fails, logs say `Invalid environment configuration` | A variable is missing or malformed; the log names it. |
| `/health` says `mongo: down` | Wrong password or user in `MONGO_URI`, or Atlas network access doesn't include `0.0.0.0/0`. |
| `/health` says `redis: down` | Wrong password or endpoint, or TLS required (`rediss://`). |
| Startup error while creating the `clicks` collection | Atlas didn't accept the time-series collection on the free tier. Not seen in testing, which used MongoDB 8.2 locally; please report it with the log. |
| Redis "OOM" errors in the logs | The 30 MB is full; lower `CLICK_STREAM_MAX_LENGTH` in Render's environment settings, and check the eviction policy is `volatile-lru`. |
| The app restarts by itself | If the worker or API crashes, the launcher stops both so Render restarts the service cleanly. Check the logs for the first error. |

## Adding a domain later

In Render: **Settings → Custom Domains**, add your domain, and create the DNS record Render shows you. Then set `BASE_URL=https://your-domain` in the service's environment, so new short links use it.
