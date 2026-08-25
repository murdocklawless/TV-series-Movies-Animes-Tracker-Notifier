import requests

from db import get_setting
from messages_i18n import t, get_lang


def send_telegram(text, poster_url=None):
    if get_setting("telegram_enabled") == "0":
        return False
    token = get_setting("telegram_bot_token")
    chat_id = get_setting("telegram_chat_id")
    if not token or not chat_id:
        return False
    try:
        if poster_url:
            r = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                json={
                    "chat_id": chat_id,
                    "photo": poster_url,
                    "caption": text,
                    "parse_mode": "Markdown",
                },
                timeout=20,
            )
        else:
            r = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
                timeout=15,
            )
        return r.status_code == 200
    except Exception:
        return False


def send_discord(text, poster_url=None, card=None):
    """Discord webhook'a bildirim gonderir; kart varsa zengin embed (kart gorunumu) kullanir."""
    if get_setting("discord_enabled") == "0":
        return False
    url = (get_setting("discord_webhook_url") or "").strip()
    if not url.startswith("https://discord.com/api/webhooks/"):
        return False
    try:
        if card:
            status_color = str(card.get("status_color") or "#22c55e").strip()
            try:
                color = int(status_color.lstrip("#"), 16)
            except ValueError:
                color = 0xF97316
            mtype = (card.get("media_type") or "tv").lower()
            labels = {"tv": "📺 Dizi", "movie": "🎬 Film", "anime": "🌸 Anime"}
            desc_parts = [labels.get(mtype, labels["tv"])]
            score = card.get("score")
            if score:
                desc_parts.append("⭐ " + str(score))
            platform = str(card.get("platform") or "").strip()
            if platform:
                desc_parts.append(platform)
            description = " · ".join(desc_parts)
            status_line = str(card.get("status_line") or "").strip()
            if status_line:
                description += "\n" + status_line
            poster_url = str(card.get("poster_url") or "").strip() or poster_url
            embed = {
                "title": str(card.get("title") or ""),
                "description": description,
                "color": color,
                "footer": {"text": t("email_signature")},
            }
            if poster_url:
                embed["image"] = {"url": poster_url}
            payload = {"embeds": [embed]}
        elif poster_url:
            payload = {
                "embeds": [{
                    "description": text,
                    "image": {"url": poster_url},
                    "color": 0xF97316,
                }]
            }
        else:
            payload = {"content": text}
        r = requests.post(url, json=payload, timeout=20)
        return r.status_code in (200, 204)
    except Exception:
        return False


def ntfy_topic_clean(topic):
    """Konu adından ntfy.sh/ vb. önekleri temizler, sadece konu adını döndürür."""
    topic = (topic or "").strip()
    topic = topic.replace("https://ntfy.sh/", "").replace("http://ntfy.sh/", "")
    topic = topic.replace("ntfy.sh/", "")
    return topic.strip("/").strip()


def send_ntfy(text, poster_url=None):
    if get_setting("ntfy_enabled") == "0":
        return False
    topic = ntfy_topic_clean(get_setting("ntfy_topic"))
    if not topic:
        return False
    try:
        if poster_url:
            img = requests.get(poster_url, timeout=20)
            if img.status_code == 200:
                content_type = img.headers.get("Content-Type", "image/jpeg")
                r = requests.post(
                    f"https://ntfy.sh/{topic}",
                    data=img.content,
                    headers={
                        "Content-Type": content_type,
                        "X-ntfy-filename": "poster.jpg",
                    },
                    timeout=30,
                )
                # Ek ile birlikte metni de ayrı bir bildirim olarak gönder
                requests.post(
                    f"https://ntfy.sh/{topic}",
                    data=text.encode("utf-8"),
                    timeout=15,
                )
                return r.status_code == 200
        r = requests.post(
            f"https://ntfy.sh/{topic}",
            data=text.encode("utf-8"),
            timeout=15,
        )
        return r.status_code == 200
    except Exception:
        return False


def _esc(value):
    import html as _html

    return _html.escape(str(value or ""), quote=True)


def _pill(label, fg, bd, bg):
    """UI'daki .badge pill stilinin inline-CSS hali."""
    return (
        f'<span style="display:inline-block; background:{bg}; color:{fg}; '
        f'font-size:11px; font-weight:600; padding:1px 8px; border-radius:999px; '
        f'border:1px solid {bd}; margin-right:4px;">{_esc(label)}</span>'
    )


def _email_card_html(card):
    """Web UI'daki dizi/film/anime kartlarinin e-posta replikasi (#0f1117 zemin uzerinde)."""
    mtype = (card.get("media_type") or "tv").lower()
    badge_key = {"tv": "badge_tv", "movie": "badge_movie", "anime": "badge_anime"}.get(mtype, "badge_tv")
    colors = {
        "tv": ("rgba(59,130,246,0.15)", "#60a5fa", "rgba(59,130,246,0.4)"),
        "movie": ("rgba(34,197,94,0.15)", "#22c55e", "rgba(34,197,94,0.4)"),
        "anime": ("rgba(236,72,153,0.15)", "#f472b6", "rgba(236,72,153,0.4)"),
    }
    bg, fg, bd = colors.get(mtype, colors["tv"])
    pills = [_pill(t(badge_key), fg, bd, bg)]
    try:
        score = float(card.get("score") or 0)
    except (TypeError, ValueError):
        score = 0
    if score > 0:
        pills.append(_pill("%.1f" % score, "#f97316", "rgba(194,120,8,0.4)", "rgba(194,120,8,0.15)"))
    platform = str(card.get("platform") or "").strip()
    if platform:
        pills.append(_pill(platform, "#d4a017", "rgba(212,160,23,0.4)", "rgba(212,160,23,0.15)"))

    poster_url = str(card.get("poster_url") or "").strip()
    if poster_url:
        poster_cell = (
            '<img src="' + _esc(poster_url) + '" alt="" width="400" height="600" '
            'style="display:block; width:400px; height:600px; border-radius:11px 11px 0 0;" />'
        )
    else:
        poster_cell = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="398" '
            'bgcolor="#22252e" style="background-color:#22252e;"><tr>'
            '<td height="598" align="center" valign="middle" style="color:#666c7d; '
            'font-family:Arial,sans-serif; font-size:14px;">' + t("poster_none") + "</td></tr></table>"
        )

    status_line = str(card.get("status_line") or "").strip()
    status_row = ""
    if status_line:
        status_color = str(card.get("status_color") or "#22c55e").strip()
        status_row = (
            '<div style="color:' + _esc(status_color) + '; font-weight:bold; font-size:12px; margin-top:8px;">'
            + _esc(status_line)
            + "</div>"
        )

    rtl = ' dir="rtl"' if get_lang() == "ar" else ""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0f1117">'
        '<tr><td style="background-color:#0f1117; padding:24px; font-family:Arial,Helvetica,sans-serif;"' + rtl + '>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" '
        'style="margin:0 auto; background-color:#171a23; border:1px solid #262a36; border-radius:12px;">'
        '<tr><td style="padding:0; line-height:0;">' + poster_cell + "</td></tr>"
        '<tr><td style="padding:10px 12px; text-align:center;">'
        '<div style="font-weight:bold; font-size:15px; color:#ffffff; margin-bottom:6px;">'
        + _esc(card.get("title"))
        + '</div><div style="line-height:1.8;">'
        + "".join(pills)
        + "</div>"
        + status_row
        + "</td></tr></table></td></tr></table>"
    )


def _email_html(text, poster_url=None):
    """Bildirim mailleri icin tablo duzenli, inline CSS'li HTML govdesi.
    Poster varsa uzak URL ile ortalanmis ve buyuk gosterilir; bilgi satiri altinda bold yazilir."""
    import html as _html

    safe = _html.escape(text or "")
    img_row = ""
    if poster_url:
        src = _html.escape(poster_url, quote=True)
        img_row = (
            '<tr><td style="text-align:center; padding-bottom:14px;">'
            '<img src="' + src + '" alt="" width="400" height="600" '
            'style="display:block; margin:0 auto; border:1px solid #262a36; '
            'border-radius:12px; background:#171a23;" />'
            "</td></tr>"
        )
    rtl = ' dir="rtl"' if get_lang() == "ar" else ""
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;"' + rtl + '>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">'
        + img_row
        + '<tr><td style="text-align:center; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#222222; line-height:1.5;">'
        + safe
        + '<br><span style="font-size:12px; font-weight:normal; color:#888888;">' + t("email_signature") + "</span>"
        + "</td></tr></table></div>"
    )


SMTP_PRESET_LABELS = {
    "gmail": "Gmail", "outlook": "Outlook/Hotmail", "yahoo": "Yahoo",
    "yandex": "Yandex", "icloud": "iCloud", "zoho": "Zoho",
}


def _log_email_send_failure(provider_label, detail=""):
    """E-posta gonderim hatasini bildirim merkezine gunde bir kez yazdirir
    (Telegram/ntfy/Discord/e-postaya tekrar push YAPMAZ)."""
    try:
        import datetime
        from db import get_db
        from notification import create_notification

        msg = t("email_send_failed", provider=provider_label)
        detail = str(detail or "").strip()
        if detail:
            msg += f" ({detail})"
        create_notification(
            "NextEp", msg, "email_error",
            notified_date=datetime.date.today().isoformat(),
        )
    except Exception as e:
        print("email error log failed:", e)


def _send_brevo(text, poster_url=None, api_key=None, email_from=None, email_to=None, card=None):
    """Brevo API v3 ile gonderim."""
    try:
        payload = {
            "sender": {"name": "NextEp", "email": email_from},
            "to": [{"email": email_to}],
            "subject": text[:120],
            "textContent": text,
            "htmlContent": _email_card_html(card) if card else _email_html(text, poster_url=poster_url),
        }
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            json=payload,
            headers={
                "api-key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=20,
        )
        if r.status_code not in (200, 201):
            try:
                detail = str(r.json().get("message") or "")
            except Exception:
                detail = ""
            _log_email_send_failure("Brevo", detail)
        return r.status_code in (200, 201)
    except Exception as e:
        _log_email_send_failure("Brevo", str(e)[:120])
        return False


_EMAIL_DIGEST_BUFFER = []


def buffer_email_notification(card, fallback_text):
    """E-postayi aninda gondermek yerine gunluk ozet icin tampona ekler."""
    if not isinstance(card, dict) or not card.get("title"):
        card = {
            "title": (fallback_text or "")[:80],
            "media_type": "tv",
            "score": None,
            "platform": None,
            "poster_url": None,
            "status_line": "",
            "status_color": "#60a5fa",
        }
    _EMAIL_DIGEST_BUFFER.append(card)


def flush_email_digest():
    """Tampondaki tum kartlari tek ozet maili olarak gonderir."""
    cards = list(_EMAIL_DIGEST_BUFFER)
    _EMAIL_DIGEST_BUFFER.clear()
    if not cards:
        return False
    return send_digest_email(cards)


NEXT_EP_LOGO_URL = "https://i.postimg.cc/V65HfXNK/nextep_mail_notification_logo.png"


def _email_digest_html(cards):
    """Gunluk ozet maili: #0f1117 zemin, logo, baslik ve kartlar arasi noktali turuncu ayirici."""
    count_pill = (
        '<span style="display:inline-block; background:rgba(34,197,94,0.15); '
        'color:#22c55e; font-weight:600; font-size:11px; border-radius:999px; '
        'border:1px solid rgba(34,197,94,0.4); padding:1px 8px; '
        'vertical-align:middle; margin-left:6px;">' + str(len(cards)) + "</span>"
    )
    header_text = t("email_header_digest", count=count_pill)
    header = (
        '<div style="max-width:400px; margin:0 auto 14px auto; padding:10px 8px 8px; '
        'text-align:center; color:#f97316; font-family:Arial,Helvetica,sans-serif; '
        'font-size:13px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; '
        'border-bottom:1px dotted #f97316;">'
        + header_text
        + "</div>"
    )
    logo_row = ""
    if NEXT_EP_LOGO_URL:
        logo_row = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
            '<tr><td style="text-align:center; padding-bottom:12px;">'
            '<img src="' + NEXT_EP_LOGO_URL + '" alt="NextEp" width="96" height="96" '
            'style="display:block; margin:0 auto;" />'
            "</td></tr></table>"
        )
    parts = [
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0f1117">'
        '<tr><td style="background-color:#0f1117; padding:24px;">',
        logo_row,
        header,
    ]
    for i, card in enumerate(cards):
        if i > 0:
            parts.append(
                '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">'
                '<tr><td style="padding:16px 0;">'
                '<div style="border-top:1px dotted #f97316; line-height:0;">&nbsp;</div>'
                "</td></tr></table>"
            )
        parts.append(_email_card_html(card))
    parts.append("</td></tr></table>")
    return "".join(parts)


def send_digest_email(cards):
    """Gunluk bildirim ozeti: tum kartlar tek mailde (#0f1117 zemin uzerinde)."""
    if get_setting("email_enabled") == "0":
        return False
    if not cards:
        return False
    provider = (get_setting("email_provider") or "brevo").strip() or "brevo"
    email_from = (get_setting("email_from") or "").strip()
    email_to = (get_setting("email_to") or "").strip()
    if not email_from or not email_to:
        return False
    subject = t("email_subject_digest", count=len(cards))
    text_lines = [subject, ""]
    for i, c in enumerate(cards, 1):
        line = str(c.get("title") or "")
        sl = str(c.get("status_line") or "").strip()
        if sl:
            line += " - " + sl
        text_lines.append("%d. %s" % (i, line))
    text_body = "\n".join(text_lines)
    html_body = _email_digest_html(cards)
    try:
        if provider == "brevo":
            api_key = (get_setting("brevo_api_key") or "").strip()
            if not api_key:
                return False
            r = requests.post(
                "https://api.brevo.com/v3/smtp/email",
                json={
                    "sender": {"name": "NextEp", "email": email_from},
                    "to": [{"email": email_to}],
                    "subject": subject,
                    "textContent": text_body,
                    "htmlContent": html_body,
                },
                headers={"api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"},
                timeout=30,
            )
            return r.status_code in (200, 201)
        host = (get_setting("smtp_host") or "").strip()
        port_raw = (get_setting("smtp_port") or "").strip()
        user = (get_setting("smtp_user") or "").strip()
        from crypto_util import decrypt_secret

        password = decrypt_secret(get_setting("smtp_pass") or "")
        if not (host and port_raw and user and password):
            return False
        return _send_generic_smtp(
            subject, None, host=host, port_raw=port_raw, user=user, password=password,
            email_from=email_from, email_to=email_to,
            html_body=html_body, text_body=text_body,
        )
    except Exception as e:
        print("digest send failed:", e)
        return False


def _send_generic_smtp(text, poster_url=None, host=None, port_raw=None, user=None, password=None, email_from=None, email_to=None, card=None, html_body=None, text_body=None):
    """Kullanici SMTP sunucusu (preset servis veya kendi VPS'i) uzerinden gonderim."""
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        return False
    preset = (get_setting("smtp_preset") or "").strip()
    prov_label = SMTP_PRESET_LABELS.get(preset, "SMTP")
    sent = False
    detail = ""
    try:
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["From"] = email_from
        msg["To"] = email_to
        msg["Subject"] = text[:120]
        msg.set_content(text_body or text)
        if card:
            msg.add_alternative(_email_card_html(card), subtype="html")
        elif html_body:
            msg.add_alternative(html_body, subtype="html")
        else:
            msg.add_alternative(_email_html(text, poster_url=poster_url), subtype="html")
        import smtplib

        if port == 465:
            import ssl

            with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=25) as s:
                s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=25) as s:
                s.ehlo()
                if port == 587:
                    import ssl

                    s.starttls(context=ssl.create_default_context())
                    s.ehlo()
                s.login(user, password)
                s.send_message(msg)
        sent = True
    except Exception as e:
        detail = str(e)[:120]
    if not sent:
        _log_email_send_failure(prov_label, detail)
    return sent


def send_email(text, poster_url=None, overrides=None, card=None):
    """E-posta bildirimi. overrides: test endpoint'inin kaydedilmemis degerleri icin."""
    if get_setting("email_enabled") == "0":
        return False
    ov = overrides or {}
    provider = (ov.get("email_provider") or get_setting("email_provider") or "brevo").strip() or "brevo"
    email_from = (ov.get("email_from") or get_setting("email_from") or "").strip()
    email_to = (ov.get("email_to") or get_setting("email_to") or "").strip()
    if not email_from or not email_to:
        return False
    if provider == "brevo":
        api_key = (ov.get("brevo_api_key") or get_setting("brevo_api_key") or "").strip()
        if not api_key:
            return False
        return _send_brevo(text, poster_url, api_key=api_key, email_from=email_from, email_to=email_to, card=card)
    # generic SMTP (preset servis veya kendi sunucu)
    host = (ov.get("smtp_host") or get_setting("smtp_host") or "").strip()
    port_raw = (ov.get("smtp_port") or get_setting("smtp_port") or "").strip()
    user = (ov.get("smtp_user") or get_setting("smtp_user") or "").strip()
    stored_pass = ov.get("smtp_pass_stored")
    if stored_pass is None:
        stored_pass = get_setting("smtp_pass") or ""
    from crypto_util import decrypt_secret

    password = decrypt_secret(stored_pass) or (ov.get("smtp_pass_plain") or "")
    if not (host and port_raw and user and password):
        return False
    return _send_generic_smtp(
        text, poster_url,
        host=host, port_raw=port_raw, user=user, password=password,
        email_from=email_from, email_to=email_to, card=card,
    )


def notify_all(text, poster_url=None, card=None, hold_email=False):
    ok = False
    if send_telegram(text, poster_url):
        ok = True
    if send_ntfy(text, poster_url):
        ok = True
    if send_discord(text, poster_url, card=card):
        ok = True
    if hold_email:
        buffer_email_notification(card, text)
        ok = True
    elif send_email(text, poster_url, card=card):
        ok = True
    return ok