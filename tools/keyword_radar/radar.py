"""빈 키워드 탐지기 (Keyword Radar)

검색 수요는 있는데 상위 결과가 낡았거나 부실한 키워드를 찾는다.

단계:
  1. 확장   - 씨앗 키워드를 네이버/구글 자동완성으로 넓힌다 (키 불필요)
  2. 검색량 - 네이버 검색광고 키워드도구로 월간 검색수를 붙인다 (NAVER_AD_* 키)
  3. 공급   - 최근 30일 새 블로그 글 수와 상위글 나이로 '빈자리'를 잰다 (NAVER API HUB 키)
  4. 시즌   - 데이터랩 3년치로 매년 몇 월에 터지는지, 다음 폭증까지 몇 주인지 (NAVER API HUB 키)
  5. 점수   - 수요 x 낡음 x 시즌 임박 보너스로 정렬해 CSV/HTML로 저장

사용:
  python radar.py 근로장려금 청년도약계좌
  python radar.py --seeds seeds.txt --max 150
"""

import argparse
import base64
import csv
import hashlib
import hmac
import html
import json
import math
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
# 2026-07-31부터 네이버 검색/데이터랩 API는 개발자센터가 아닌 네이버 클라우드 NAVER API HUB에서 발급·호출한다
APIHUB = "https://naverapihub.apigw.ntruss.com"


def hub_headers(key_id, key):
    return {"X-NCP-APIGW-API-KEY-ID": key_id, "X-NCP-APIGW-API-KEY": key}

# 특정 사이트를 찾아가는 검색은 우리가 가져올 수 없는 트래픽이라 제외
NAVIGATIONAL = ["나무위키", "유튜브", "디시", "블로그", "카페", "더쿠", "인스타"]

# 검색 의도가 분명한 꼬리말: 붙였을 때 자동완성이 나오면 실제 수요가 있다는 뜻
MODIFIERS = ["조건", "대상", "신청", "신청기간", "지급일", "조회", "계산", "계산기",
             "방법", "서류", "기준", "금액", "후기", "2027"]


# ---------------------------------------------------------------- 공통

def load_env():
    env = {}
    path = HERE / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def http_json(url, headers=None, data=None, timeout=10):
    body = json.dumps(data).encode() if data is not None else None
    h = dict(UA, **(headers or {}))
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 1. 확장

def naver_suggest(q):
    url = ("https://ac.search.naver.com/nx/ac?con=1&frm=nv&ans=2&r_format=json"
           "&r_enc=UTF-8&q_enc=UTF-8&st=100&q=" + urllib.parse.quote(q))
    try:
        items = http_json(url).get("items") or [[]]
        return [x[0] for x in items[0]]
    except Exception:
        return []


def google_suggest(q):
    url = ("https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&q="
           + urllib.parse.quote(q))
    try:
        return http_json(url)[1]
    except Exception:
        return []


def expand(seed):
    """키워드 -> (출처 집합, 자동완성 최고 순위). 순위가 높을수록 많이 검색된다."""
    found = {}
    for q in [seed] + [f"{seed} {m}" for m in MODIFIERS]:
        for src, fn in (("naver", naver_suggest), ("google", google_suggest)):
            for pos, kw in enumerate(fn(q)):
                kw = " ".join(kw.split())
                if kw and not any(w in kw for w in NAVIGATIONAL):
                    srcs, best = found.get(kw, (set(), 99))
                    found[kw] = (srcs | {src}, min(best, pos))
            time.sleep(0.05)
    return found


# ---------------------------------------------------------------- 2. 검색량

def searchad_volumes(keywords, env):
    """네이버 검색광고 키워드도구. 키는 공백 없는 형태로 매칭된다."""
    cid, key, secret = (env.get("NAVER_AD_CUSTOMER_ID"), env.get("NAVER_AD_ACCESS_LICENSE"),
                        env.get("NAVER_AD_SECRET_KEY"))
    if not (cid and key and secret):
        return {}
    out = {}
    uri = "/keywordstool"
    hints = list(dict.fromkeys(k.replace(" ", "") for k in keywords))
    for i in range(0, len(hints), 5):
        ts = str(int(time.time() * 1000))
        sig = base64.b64encode(hmac.new(secret.encode(), f"{ts}.GET.{uri}".encode(),
                                        hashlib.sha256).digest()).decode()
        qs = urllib.parse.urlencode({"hintKeywords": ",".join(hints[i:i + 5]), "showDetail": 1})
        try:
            res = http_json(f"https://api.searchad.naver.com{uri}?{qs}", headers={
                "X-Timestamp": ts, "X-API-KEY": key, "X-Customer": cid, "X-Signature": sig})
        except Exception as e:
            log(f"  [검색량] 실패: {e}")
            continue
        for row in res.get("keywordList", []):
            def n(v):
                return 5 if isinstance(v, str) else int(v)  # "< 10" 은 5로
            out[row["relKeyword"]] = {
                "volume": n(row["monthlyPcQcCnt"]) + n(row["monthlyMobileQcCnt"]),
                "ad_comp": row.get("compIdx", ""),
            }
        time.sleep(0.2)
    return out


# ---------------------------------------------------------------- 3. 공급(낡음)

def blog_supply(kw, env):
    """공급 측정. API의 관련도순은 실제 검색화면과 달라 낡은 글이 위로 몰리므로,
    '최근 30일 새 글 수'(최신순 100개 중)를 주 지표로, 관련도순 상위글 나이를 보조 지표로 쓴다."""
    cid, sec = env.get("NAVER_CLIENT_ID"), env.get("NAVER_CLIENT_SECRET")
    if not (cid and sec):
        return None
    today = date.today()

    def fetch(sort, n):
        url = (f"{APIHUB}/search/v1/blog?display={n}&sort={sort}&format=json&query="
               + urllib.parse.quote(kw))
        res = http_json(url, headers=hub_headers(cid, sec))
        ages = []
        for it in res.get("items", []):
            try:
                d = datetime.strptime(it["postdate"], "%Y%m%d").date()
            except Exception:
                continue
            if d.year >= 2000:  # 19900101 같은 잘못된 날짜 제외
                ages.append((today - d).days)
        return res, ages

    try:
        res, ages = fetch("sim", 10)
        _, recent = fetch("date", 100)
    except Exception as e:
        log(f"  [공급] {kw}: {e}")
        return None
    new30 = sum(a <= 30 for a in recent)
    return {
        "new_30d": f"{new30}+" if new30 == len(recent) == 100 else new30,
        # 최신 글 100개가 쌓이는 데 걸린 일수. 길수록 새로 쓰는 사람이 적다 (100개 미만이면 전체가 적음)
        "span100": max(recent) if len(recent) >= 100 else 9999,
        "median_age": int(statistics.median(ages)) if ages else 9999,
        "old_share": round(sum(a > 365 for a in ages) / len(ages), 2) if ages else 1.0,
        "total": res.get("total", 0),
    }


# ---------------------------------------------------------------- 4. 시즌

def datalab_seasons(keywords, env):
    cid, sec = env.get("NAVER_CLIENT_ID"), env.get("NAVER_CLIENT_SECRET")
    if not (cid and sec):
        return {}
    end = date.today().replace(day=1) - timedelta(days=1)
    start = date(end.year - 3, end.month, 1) + timedelta(days=32)
    start = start.replace(day=1)
    out = {}
    for i in range(0, len(keywords), 5):
        chunk = keywords[i:i + 5]
        body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "timeUnit": "month",
                "keywordGroups": [{"groupName": k, "keywords": [k]} for k in chunk]}
        try:
            res = http_json(f"{APIHUB}/search-trend/v1/search", data=body,
                            headers=hub_headers(cid, sec))
        except Exception as e:
            log(f"  [시즌] 실패: {e}")
            continue
        for g in res.get("results", []):
            by_month = {}
            for p in g.get("data", []):
                by_month.setdefault(int(p["period"][5:7]), []).append(p["ratio"])
            if not by_month:
                continue
            avg = {m: sum(v) / len(v) for m, v in by_month.items()}
            mean = sum(avg.values()) / len(avg)
            peak = max(avg, key=avg.get)
            last = g["data"][-1]["ratio"]  # 검색광고 검색량이 집계된 지난달
            out[g["title"]] = {"peak_month": peak,
                               "season_strength": round(avg[peak] / mean, 1) if mean else 0,
                               "weeks_to_peak": weeks_until_month(peak),
                               # 지난달 검색량에 곱하면 피크 달 검색량 추정치 (지난달이 0이면 추정 불가)
                               "peak_mult": min(avg[peak] / last, 20) if last else None}
        time.sleep(0.2)
    return out


def weeks_until_month(m):
    today = date.today()
    y = today.year if m >= today.month else today.year + 1
    return max(0, (date(y, m, 1) - today).days // 7)


# ---------------------------------------------------------------- 5. 점수

def monthly_new_posts(row):
    """한 달에 새로 올라오는 블로그 글 수 추정. 최신 100개가 쌓인 기간으로 환산한다."""
    span, new30 = row.get("span100"), row.get("new_30d")
    if span is None:
        return None
    if span >= 9999:  # 글이 100개도 안 되면 최근 30일 개수 그대로
        return new30 if isinstance(new30, int) else 100
    return 100 * 30 / max(span, 1)


def score(row):
    vol = row.get("peak_volume", row.get("volume"))
    monthly = monthly_new_posts(row)
    bonus = 1.3 if row.get("season_strength", 0) >= 1.5 and 3 <= row.get("weeks_to_peak", 99) <= 12 else 1.0
    if vol is not None and monthly is not None:
        # 글 하나가 나눠 갖는 검색 수요. 클수록 빈자리
        row["demand_ratio"] = round(vol / max(monthly, 1), 1)
        s = math.log10(1 + row["demand_ratio"]) * bonus
        return round(s * (0.5 if vol < 100 else 1.0), 2)  # 검색량이 너무 작으면 감점
    if vol is not None:
        demand = math.log10(vol + 10)
    else:  # 검색량 키가 없으면 자동완성 순위와 양쪽 등장 여부로 추정
        demand = 1.0 + (0.5 if "+" in row["sources"] else 0) + (10 - min(row["ac_rank"], 10)) / 10
    age, new30 = row.get("median_age"), row.get("new_30d")
    if new30 is not None:  # 새 글이 쌓이는 속도가 느릴수록 빈자리 (100개에 1년 이상이면 만점)
        gap = min(math.log10(row["span100"] + 1) / math.log10(366), 1.0)
        stale = 0.75 * gap + 0.25 * min(age / 730, 1.0)
    else:
        stale = min(age / 730, 1.0) if age is not None else 0.5
    bonus = 1.0
    # 새 사이트는 색인·순위에 시간이 걸리므로 피크 3~12주 전이 제작 적기
    if row.get("season_strength", 0) >= 1.5 and 3 <= row.get("weeks_to_peak", 99) <= 12:
        bonus = 1.6  # 지금 만들면 폭증 직전에 자리 잡는다
    return round(demand * (0.3 + 0.7 * stale) * bonus, 2)


# ---------------------------------------------------------------- 출력

COLS = ["score", "keyword", "volume", "peak_volume", "demand_ratio", "ac_rank", "new_30d", "span100", "median_age", "old_share", "total",
        "peak_month", "season_strength", "weeks_to_peak", "ad_comp", "seed", "sources"]
LABELS = {"score": "기회점수", "keyword": "키워드", "volume": "월 검색수", "peak_volume": "피크 예상 검색수", "demand_ratio": "검색÷월새글", "ac_rank": "자동완성 순위", "new_30d": "최근30일 새글", "span100": "새글100개 소요(일)",
          "median_age": "상위글 나이(일)", "old_share": "1년↑ 비율", "total": "블로그 문서수",
          "peak_month": "피크 월", "season_strength": "시즌 강도", "weeks_to_peak": "피크까지(주)",
          "ad_comp": "광고경쟁", "seed": "씨앗", "sources": "출처"}


def write_outputs(rows, stem):
    out = HERE / "output"
    out.mkdir(exist_ok=True)
    csv_path, html_path = out / f"{stem}.csv", out / f"{stem}.html"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow([LABELS[c] for c in COLS])
        for r in rows:
            w.writerow([r.get(c, "") for c in COLS])
    head = "".join(f"<th>{LABELS[c]}</th>" for c in COLS)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(r.get(c, '')))}</td>" for c in COLS)
                   + "</tr>" for r in rows)
    html_path.write_text(f"""<!doctype html><meta charset="utf-8"><title>Keyword Radar</title>
<style>body{{font-family:system-ui,sans-serif;margin:16px;background:#fff;color:#111}}
table{{border-collapse:collapse;font-size:13px}}th,td{{border:1px solid #ddd;padding:4px 8px;text-align:left}}
th{{background:#f4f4f4;position:sticky;top:0}}tr:nth-child(-n+11) td{{background:#fff8e1}}</style>
<h1>빈 키워드 탐지 결과 ({date.today()})</h1>
<p>기회점수 = log(피크 예상 검색수 ÷ 월 새 글 수) × 시즌 임박 보너스. 월 검색 100 미만은 감점. 상위 10개는 노란색.</p>
<table><tr>{head}</tr>{body}</table>""", encoding="utf-8")
    return csv_path, html_path


# ---------------------------------------------------------------- main

def main():
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="빈 키워드 탐지기")
    ap.add_argument("seeds", nargs="*", help="씨앗 키워드")
    ap.add_argument("--seeds", dest="seed_file", help="씨앗 키워드 파일 (한 줄에 하나)")
    ap.add_argument("--max", type=int, default=120, help="분석할 최대 키워드 수")
    ap.add_argument("--per-seed", type=int, default=0,
                    help="씨앗마다 자동완성 순위 상위 N개만 분석 (씨앗이 많을 때 골고루 보기 위함)")
    ap.add_argument("--related", type=int, default=5,
                    help="씨앗마다 검색광고 연관 키워드 중 검색량 상위 N개를 후보에 추가 (0이면 끔)")
    args = ap.parse_args()

    seeds = list(args.seeds)
    if args.seed_file:
        seeds += [l.strip() for l in Path(args.seed_file).read_text(encoding="utf-8").splitlines()
                  if l.strip() and not l.startswith("#")]
    if not seeds:
        ap.error("씨앗 키워드를 하나 이상 주세요")

    env = load_env()
    modes = ["자동완성"]
    ad_keys = ["NAVER_AD_CUSTOMER_ID", "NAVER_AD_ACCESS_LICENSE", "NAVER_AD_SECRET_KEY"]
    hub_keys = ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]
    for name, keys in (("검색량", ad_keys), ("낡음·시즌", hub_keys)):
        missing = [k for k in keys if not env.get(k)]
        if not missing:
            modes.append(name)
        elif len(missing) < len(keys):
            log(f"주의: '{name}' 단계에 필요한 키가 비어 있음 -> {', '.join(missing)}")
    log(f"사용 가능한 단계: {', '.join(modes)}")

    rows = {}
    for seed in seeds:
        log(f"[확장] {seed}")
        for kw, (srcs, pos) in expand(seed).items():
            r = rows.setdefault(kw, {"keyword": kw, "seed": seed, "sources": set(), "ac_rank": 99})
            r["sources"] |= srcs
            r["ac_rank"] = min(r["ac_rank"], pos)
    if args.per_seed:
        by_seed = {}
        for r in sorted(rows.values(), key=lambda r: r["ac_rank"]):
            by_seed.setdefault(r["seed"], []).append(r["keyword"])
        keywords = [k for ks in by_seed.values() for k in ks[: args.per_seed]][: args.max]
    else:
        keywords = list(rows)[: args.max]
    rows = {k: rows[k] for k in keywords}
    log(f"  후보 {len(keywords)}개")

    vols = searchad_volumes(keywords, env)
    for k, r in rows.items():
        r.update(vols.get(k.replace(" ", ""), {}))

    if args.related and vols:
        log("[연관] 검색광고 연관 키워드에서 검색량 많은 후보 추가")
        have = {k.replace(" ", "") for k in rows}
        for seed in seeds:
            head = seed.split()[0]
            related = searchad_volumes([seed], env)
            picks = sorted(((k, d) for k, d in related.items()
                            if head in k and k not in have and d["volume"] >= 300
                            and not any(w in k for w in NAVIGATIONAL)),
                           key=lambda kd: -kd[1]["volume"])[: args.related]
            for k, d in picks:
                rows[k] = {"keyword": k, "seed": seed, "sources": {"ad"}, "ac_rank": 99, **d}
                have.add(k)
        keywords = list(rows)
        log(f"  후보 {len(keywords)}개")

    if all(env.get(k) for k in hub_keys):
        log("[공급] 블로그 상위글 나이 측정")
        for k, r in rows.items():
            s = blog_supply(k, env)
            if s:
                r.update(s)
            time.sleep(0.1)
        log("[시즌] 데이터랩 3년치 분석")
        for k, s in datalab_seasons(keywords, env).items():
            rows[k].update(s)
    for r in rows.values():
        if r.get("volume") is not None:
            mult = r.pop("peak_mult", None)
            r["peak_volume"] = round(r["volume"] * mult) if mult else r["volume"]

    out = []
    for r in rows.values():
        r["sources"] = "+".join(sorted(r["sources"]))
        r["ac_rank"] += 1
        r["score"] = score(r)
        out.append(r)
    out.sort(key=lambda r: r["score"], reverse=True)

    stem = f"radar_{datetime.now():%Y%m%d_%H%M}"
    csv_path, html_path = write_outputs(out, stem)
    log(f"\n완료: {csv_path}\n      {html_path}")
    for r in out[:15]:
        print(f"{r['score']:>5}  {r['keyword']}")


if __name__ == "__main__":
    main()
