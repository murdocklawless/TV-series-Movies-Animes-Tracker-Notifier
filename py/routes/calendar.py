"""Takvim aboneligi (1.85) — public ICS beslemesi.

GET /calendar/<token>/nextep.ics
  - token = user_settings.tp_calendar_uuid (Stremio deseninin kardesi)
  - yalniz BUGUN ve SONRASI: dizi/belgesel dizisi bolumleri, anime bolumleri
    ve film vizyonlari (arsivliler haric)
  - yanlis/bos token -> 404
"""
import datetime

from flask import Blueprint, Response, abort

from db import get_db, get_setting, today_str
from routes.stremio import _find_owner_by_uuid

import ics

calendar_bp = Blueprint("calendar", __name__)


def _build_events(owner_id):
    """Kullanicinin yaklasan olaylarini ICS olay sozluklerine cevirir."""
    conn = get_db()
    today = today_str()
    try:
        now = int(datetime.datetime.now().timestamp())
    except Exception:
        now = 0
    tzid = None
    try:
        tzid = (get_setting("timezone") or "").strip() or None
    except Exception:
        tzid = None
    events = []

    # Dizi + belgesel dizisi
    try:
        rows = conn.execute(
            "SELECT id, title, runtime FROM followed "
            "WHERE user_id=? AND media_type='tv' AND COALESCE(archived,0)=0",
            (owner_id,),
        ).fetchall()
    except Exception:
        rows = []
    for r in rows:
        try:
            eps = conn.execute(
                "SELECT season, episode, air_date, air_time, name, runtime FROM episodes "
                "WHERE follow_id=? AND air_date IS NOT NULL AND air_date>=? "
                "ORDER BY air_date ASC, season ASC, episode ASC",
                (r["id"], today),
            ).fetchall()
        except Exception:
            eps = []
        for e in eps:
            try:
                se = "S%02dE%02d" % (int(e["season"] or 0), int(e["episode"] or 0))
            except Exception:
                se = ""
            name = (e["name"] or "").strip()
            summary = "%s · %s" % (r["title"], se) if se else (r["title"] or "")
            if name:
                summary += " · " + name
            ev = {
                "uid": "nextep-tv-%s-%sx%s@nextep" % (r["id"], e["season"], e["episode"]),
                "summary": summary,
                "description": "%s %s" % (r["title"], se),
                "date": e["air_date"],
            }
            if e["air_time"]:
                ev["epoch"] = int(e["air_time"])
                ev["tzid"] = tzid
                # Sure: GERCEK bolum suresi; yoksa 1 saat. Dizi geneli runtime
                # (followed.runtime) KULLANILMAZ — bazi dizilerde 130 dk gibi
                # sezon/ozel bolum degerleri tasiyip takvimde 2+ saat yer tutuyordu.
                try:
                    ev["duration_min"] = int(e["runtime"] or 0) or 60
                except Exception:
                    ev["duration_min"] = 60
            events.append(ev)

    # Anime
    try:
        arows = conn.execute(
            "SELECT id, title, duration FROM anime "
            "WHERE user_id=? AND COALESCE(archived,0)=0",
            (owner_id,),
        ).fetchall()
    except Exception:
        arows = []
    for a in arows:
        try:
            aeps = conn.execute(
                "SELECT episode, air_at FROM anime_episodes "
                "WHERE anime_id=? AND air_at IS NOT NULL AND air_at>=? "
                "ORDER BY episode ASC",
                (a["id"], now),
            ).fetchall()
        except Exception:
            aeps = []
        for e in aeps:
            summary = "%s · EP%s" % (a["title"], int(e["episode"] or 0))
            events.append(
                {
                    "uid": "nextep-anime-%s-%s@nextep" % (a["id"], e["episode"]),
                    "summary": summary,
                    "description": summary,
                    "epoch": int(e["air_at"]),
                    "tzid": tzid,
                    "duration_min": int(a["duration"] or 0) or 60,
                }
            )

    # Film (vizyona girecekler)
    try:
        mrows = conn.execute(
            "SELECT id, title, release_date FROM followed "
            "WHERE user_id=? AND media_type='movie' AND COALESCE(archived,0)=0 "
            "AND release_date IS NOT NULL AND release_date>=?",
            (owner_id, today),
        ).fetchall()
    except Exception:
        mrows = []
    for m in mrows:
        events.append(
            {
                "uid": "nextep-movie-%s@nextep" % (m["id"],),
                "summary": m["title"] or "",
                "description": m["title"] or "",
                "date": m["release_date"],
            }
        )

    conn.close()
    return events


@calendar_bp.route("/calendar/<token>/nextep.ics")
def nextep_ics(token):
    owner = 0
    try:
        owner = _find_owner_by_uuid(token, "calendar")
    except Exception:
        owner = 0
    if not owner:
        abort(404)
    try:
        body = ics.build_calendar(_build_events(owner), cal_name="NextEp")
    except Exception:
        abort(500)
    resp = Response(body, mimetype="text/calendar")
    resp.headers["Content-Type"] = "text/calendar; charset=utf-8"
    resp.headers["Content-Disposition"] = 'inline; filename="nextep.ics"'
    resp.headers["Cache-Control"] = "no-store"
    return resp
