"""Elle minimal iCalendar (RFC 5545) ureteci — 1.85 takvim aboneligi.

Dis paket YOK (proje felsefesi: sifirdan yaz). Yalniz ihtiyac duyulan
parcalar: VCALENDAR/VEVENT/VALARM, tarih veya TZID'li saat, 75-oktet katlama.
"""
import datetime


def _esc(text):
    """RFC 5545 metin kacisi: \\ ; , ve satir sonlari."""
    s = str(text if text is not None else "")
    s = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    s = s.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
    return s


def _fold(line):
    """RFC 5545 75-oktet satir katlama (UTF-8 karakteri bolmeden)."""
    b = line.encode("utf-8")
    if len(b) <= 75:
        return line
    chunks = []
    cur = b
    while len(cur) > 75:
        cut = 75
        # Cok baytli UTF-8 karakterinin ortasindan kesmemek icin geri kay.
        while cut > 0 and (cur[cut] & 0xC0) == 0x80:
            cut -= 1
        if cut <= 0:
            cut = 75
        chunks.append(cur[:cut].decode("utf-8", "ignore"))
        cur = cur[cut:]
    chunks.append(cur.decode("utf-8", "ignore"))
    return "\r\n ".join(chunks)


def _tz(tzid):
    if not tzid:
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(str(tzid))
    except Exception:
        return None


def _stamp_utc(epoch):
    return datetime.datetime.fromtimestamp(
        int(epoch), datetime.timezone.utc
    ).strftime("%Y%m%dT%H%M%SZ")


def _stamp_local(epoch, tzinfo):
    return datetime.datetime.fromtimestamp(int(epoch), tzinfo).strftime("%Y%m%dT%H%M%S")


def _date_basic(iso):
    return str(iso).replace("-", "")


def _vevent(ev, dtstamp):
    """Tek olay -> satir listesi.

    ev: {uid, summary, description?, date? (YYYY-AA-GG), epoch? (int),
         tzid?, duration_min?}
    Saat (epoch) varsa TZID'li (tzid yoksa UTC) zamanli olay; yoksa tum gun.
    """
    out = ["BEGIN:VEVENT", "UID:" + _esc(ev.get("uid")) , "DTSTAMP:" + dtstamp]
    epoch = ev.get("epoch")
    if epoch:
        dur = int(ev.get("duration_min") or 60)
        end = int(epoch) + dur * 60
        tzid = ev.get("tzid")
        tzinfo = _tz(tzid)
        if tzinfo is not None:
            out.append("DTSTART;TZID=%s:%s" % (tzid, _stamp_local(epoch, tzinfo)))
            out.append("DTEND;TZID=%s:%s" % (tzid, _stamp_local(end, tzinfo)))
        else:
            out.append("DTSTART:" + _stamp_utc(epoch))
            out.append("DTEND:" + _stamp_utc(end))
    else:
        d = ev.get("date")
        if not d:
            return []
        try:
            d2 = (datetime.date.fromisoformat(str(d)) + datetime.timedelta(days=1)).isoformat()
        except Exception:
            d2 = str(d)
        out.append("DTSTART;VALUE=DATE:" + _date_basic(d))
        out.append("DTEND;VALUE=DATE:" + _date_basic(d2))
    summary = ev.get("summary") or ""
    out.append("SUMMARY:" + _esc(summary))
    if ev.get("description"):
        out.append("DESCRIPTION:" + _esc(ev.get("description")))
    # Yayindan 1 gun once hatirlatici (Apple destekler; Google abone takvimde
    # takvim duzeyindeki bildirim kullanilir).
    out.append("BEGIN:VALARM")
    out.append("TRIGGER:-P1D")
    out.append("ACTION:DISPLAY")
    out.append("DESCRIPTION:" + _esc(summary))
    out.append("END:VALARM")
    out.append("END:VEVENT")
    return out


def build_calendar(events, cal_name="NextEp"):
    """Olay listesinden tam VCALENDAR govdesi (CRLF satir sonlari)."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//NextEp//Takvim//TR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:" + _esc(cal_name),
        # Abone istemcilere "saatlik yenile" ipucu (Google/Apple kismen dikkate alir).
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    dtstamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for ev in events or []:
        lines.extend(_vevent(ev, dtstamp))
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"
