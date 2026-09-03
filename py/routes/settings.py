import os
import json
import requests
import zoneinfo

from flask import Blueprint, jsonify, request

from db import get_setting, set_setting, today_str
from crypto_util import encrypt_secret, decrypt_secret
from notifications import ntfy_topic_clean, _send_generic_smtp, _email_card_html
from messages_i18n import t
from ramcache import bump
from scheduler import schedule_releases, _tmdb_genre_names, _anilist_genre_names, NOTIF_TYPES

settings_bp = Blueprint("settings", __name__)

# Yedek/Restore sinirlari — per-mode 30 (db 30 + full 30 = hedef basina 60)
MAX_BACKUPS_DB = 30
MAX_BACKUPS_FULL = 30
MAX_RESTORES_DB = 30
MAX_RESTORES_FULL = 30


def _prune_remote_rsync(host, port, path, user, key_plain, mode):
    """Rsync hedefte per-mode 30 siniri: en eskileri sil (fail-soft)."""
    try:
        import tempfile
        import subprocess

        if not path.endswith("/"):
            path += "/"
        # liste al
        key_file = None
        try:
            cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-p", str(port or "22")]
            if key_plain and "PRIVATE KEY" in key_plain:
                kfd, key_file = tempfile.mkstemp(prefix="bk_prune_key_")
                os.close(kfd)
                with open(key_file, "w") as kf:
                    kf.write(key_plain)
                try:
                    os.chmod(key_file, 0o600)
                except Exception:
                    pass
                cmd.extend(["-i", key_file])
            cmd.extend([f"{user}@{host}", f"ls -1 {path} 2>/dev/null"])
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if proc.returncode != 0:
                return
            files = [os.path.basename(l.strip()) for l in (proc.stdout or "").splitlines() if l.strip()]
            # per-mode filtre
            if mode == "db":
                cand = [f for f in files if f.startswith("nextep-") and f.endswith(".db") and not f.startswith("nextep-full-")]
                limit = MAX_BACKUPS_DB
            else:
                cand = [f for f in files if f.startswith("nextep-full-") and f.endswith(".tar.gz")]
                limit = MAX_BACKUPS_FULL
            cand.sort()  # isimde YYYYMMDD-HHMMSS oldugundan kronolojik
            if len(cand) <= limit:
                return
            to_del = cand[: len(cand) - limit]  # en eskiler
            try:
                print(f"rsync prune: mode={mode} cand={len(cand)} limit={limit} deleting {len(to_del)}: {to_del[:3]}", flush=True)
            except Exception:
                pass
            for name in to_del:
                try:
                    rm_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-p", str(port or "22")]
                    if key_file:
                        rm_cmd.extend(["-i", key_file])
                    rm_cmd.extend([f"{user}@{host}", f"rm -f {path}{name}"])
                    subprocess.run(rm_cmd, capture_output=True, text=True, timeout=15)
                except Exception as e:
                    try:
                        print(f"rsync delete failed {name}: {e}", flush=True)
                    except Exception:
                        pass
                    continue
        finally:
            if key_file and os.path.exists(key_file):
                try:
                    os.unlink(key_file)
                except Exception:
                    pass
    except Exception as e:
        try:
            print(f"rsync prune failed: {e}", flush=True)
        except Exception:
            pass


def _prune_remote_samba(host, port, share, user, password, mode):
    """Samba hedefte per-mode 30 siniri: en eskileri sil (fail-soft)."""
    try:
        import uuid

        from smbprotocol.connection import Connection
        from smbprotocol.session import Session
        from smbprotocol.tree import TreeConnect
        from smbprotocol.open import Open, CreateDisposition, FileAttributes, ShareAccess, ImpersonationLevel, CreateOptions, DirectoryAccessMask, FilePipePrinterAccessMask
        from smbprotocol.file_info import FileInformationClass

        conn = Connection(uuid.uuid4(), host, int(port or 445))
        conn.connect(timeout=10)
        try:
            sess = Session(conn, username=user, password=password)
            sess.connect()
            tree = TreeConnect(sess, f"\\\\{host}\\{share}")
            tree.connect()
            fd_dir = Open(tree, "")
            fd_dir.create(ImpersonationLevel.Impersonation, DirectoryAccessMask.FILE_LIST_DIRECTORY, FileAttributes.FILE_ATTRIBUTE_DIRECTORY, ShareAccess.FILE_SHARE_READ, CreateDisposition.FILE_OPEN, CreateOptions.FILE_DIRECTORY_FILE)
            try:
                files_raw = fd_dir.query_directory("*", FileInformationClass.FILE_DIRECTORY_INFORMATION)
            finally:
                fd_dir.close()
            names = []
            for f in files_raw:
                try:
                    name = f["file_name"].get_value().decode("utf-16-le").rstrip("\x00")
                except Exception:
                    continue
                names.append(name)
            if mode == "db":
                cand = [n for n in names if n.startswith("nextep-") and n.endswith(".db") and not n.startswith("nextep-full-")]
                limit = MAX_BACKUPS_DB
            else:
                cand = [n for n in names if n.startswith("nextep-full-") and n.endswith(".tar.gz")]
                limit = MAX_BACKUPS_FULL
            cand.sort()
            if len(cand) <= limit:
                tree.disconnect()
                sess.disconnect()
                conn.disconnect()
                return
            to_del = cand[: len(cand) - limit]
            try:
                print(f"samba prune: mode={mode} cand={len(cand)} limit={limit} deleting {len(to_del)}: {to_del[:3]}", flush=True)
            except Exception:
                pass
            for name in to_del:
                try:
                    fd = Open(tree, name)
                    fd.create(ImpersonationLevel.Impersonation, FilePipePrinterAccessMask.DELETE, FileAttributes.FILE_ATTRIBUTE_NORMAL, ShareAccess.FILE_SHARE_READ | ShareAccess.FILE_SHARE_WRITE | ShareAccess.FILE_SHARE_DELETE, CreateDisposition.FILE_OPEN, CreateOptions.FILE_DELETE_ON_CLOSE | CreateOptions.FILE_NON_DIRECTORY_FILE)
                    try:
                        fd.close()
                    except Exception:
                        pass
                except Exception as e:
                    try:
                        print(f"samba delete failed {name}: {e}", flush=True)
                    except Exception:
                        pass
                    continue
            tree.disconnect()
            sess.disconnect()
            conn.disconnect()
        except Exception as e:
            try:
                print(f"samba prune failed: {e}", flush=True)
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass
    except Exception as e:
        try:
            print(f"samba prune import/connect failed: {e}", flush=True)
        except Exception:
            pass


def _prune_local_restores():
    """Yerel /etc/nextep/restore icinde per-mode 30 siniri: en eski klasorleri sil (fail-soft)."""
    try:
        import shutil

        from config import BASE_DIR

        restore_root = os.path.join(BASE_DIR, "restore")
        if not os.path.isdir(restore_root):
            return
        entries = []
        for name in os.listdir(restore_root):
            p = os.path.join(restore_root, name)
            if not os.path.isdir(p):
                continue
            if not name.startswith("restore_"):
                continue
            entries.append(name)
        # per-mode ayir: isimde _db_ veya _full_ var
        db_entries = [n for n in entries if "_db_" in n]
        full_entries = [n for n in entries if "_full_" in n]
        # fallback: mode etiketi olmayan eski klasorler db sayilsin
        other = [n for n in entries if n not in db_entries and n not in full_entries]
        # sinir kontrolu ayri
        for lst, limit in ((db_entries, MAX_RESTORES_DB), (full_entries, MAX_RESTORES_FULL)):
            if len(lst) <= limit:
                continue
            lst.sort()  # restore_{ts}_... ts kronolojik oldugundan en eski basta
            to_del = lst[: len(lst) - limit]
            try:
                print(f"local restore prune: mode={'db' if lst is db_entries else 'full'} cand={len(lst)} limit={limit} deleting {len(to_del)}", flush=True)
            except Exception:
                pass
            for name in to_del:
                try:
                    shutil.rmtree(os.path.join(restore_root, name), ignore_errors=True)
                except Exception:
                    continue
        # diger (etiketsiz) klasorler toplam restore limitini asiyorsa en eskilerden sil
        if other:
            # bunlari db kotasina dahil et
            all_db = db_entries + other
            if len(all_db) > MAX_RESTORES_DB:
                all_db.sort()
                to_del = all_db[: len(all_db) - MAX_RESTORES_DB]
                for name in to_del:
                    if name in other:
                        try:
                            shutil.rmtree(os.path.join(restore_root, name), ignore_errors=True)
                        except Exception:
                            continue
    except Exception as e:
        try:
            print(f"local restore prune failed: {e}", flush=True)
        except Exception:
            pass


@settings_bp.route("/api/fav_actors", methods=["GET", "POST"])
def fav_actors():
    if request.method == "GET":
        raw = get_setting("fav_actors")
        actors = json.loads(raw) if raw else []
        return jsonify({"actors": actors})
    body = request.get_json(silent=True) or {}
    person_id = body.get("person_id")
    name = (body.get("name") or "").strip()
    if not person_id:
        return jsonify({"error": "Oyuncu id gerekli"}), 400
    raw = get_setting("fav_actors")
    actors = json.loads(raw) if raw else []
    if any(a.get("person_id") == person_id for a in actors):
        actors = [a for a in actors if a.get("person_id") != person_id]
        added = False
    else:
        actors.append({"person_id": person_id, "name": name})
        added = True
    set_setting("fav_actors", json.dumps(actors, ensure_ascii=False))
    try:
        from fav_listings import invalidate_fav_listing
        invalidate_fav_listing("actor", str(person_id))
    except Exception:
        pass
    return jsonify({"ok": True, "added": added, "actors": actors})


@settings_bp.route("/api/fav_anime_chars", methods=["GET", "POST"])
def fav_anime_chars():
    if request.method == "GET":
        raw = get_setting("fav_anime_chars")
        chars = json.loads(raw) if raw else []
        return jsonify({"characters": chars})
    body = request.get_json(silent=True) or {}
    character_id = body.get("character_id")
    name = (body.get("name") or "").strip()
    anime_title = (body.get("anime_title") or "").strip()
    if not character_id:
        return jsonify({"error": "Karakter id gerekli"}), 400
    raw = get_setting("fav_anime_chars")
    chars = json.loads(raw) if raw else []
    if any(a.get("character_id") == character_id for a in chars):
        chars = [a for a in chars if a.get("character_id") != character_id]
        added = False
    else:
        chars.append({"character_id": character_id, "name": name, "anime_title": anime_title})
        added = True
    set_setting("fav_anime_chars", json.dumps(chars, ensure_ascii=False))
    return jsonify({"ok": True, "added": added, "characters": chars})


@settings_bp.route("/api/timezones")
def list_timezones():
    zones = sorted(z for z in zoneinfo.available_timezones() if "/" in z or z == "UTC")
    tz_country = {}
    try:
        with open("/usr/share/zoneinfo/zone.tab") as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    tz_country[parts[2]] = parts[0]
    except OSError:
        pass

    cc_lang = _country_languages()

    out = []
    for z in zones:
        cc = tz_country.get(z, "")
        locale = ""
        if cc:
            lang = cc_lang.get(cc.upper(), "")
            if lang:
                locale = f"{lang}-{cc.upper()}"
        out.append({"value": z, "country": cc, "locale": locale})
    return jsonify(out)


def _country_languages():
    """glibc locale dosyalarından ülke kodu -> birincil dil (örn. US -> en)."""
    locales_dir = "/usr/share/i18n/locales"
    cc_lang = {}
    try:
        names = sorted(os.listdir(locales_dir))
    except OSError:
        return cc_lang
    preferred = {
        "TR": "tr", "FR": "fr", "ES": "es", "IT": "it", "DE": "de",
        "US": "en", "GB": "en", "CA": "en", "AU": "en", "NZ": "en",
        "BR": "pt", "PT": "pt", "BE": "nl", "CH": "de", "AT": "de",
        "MX": "es", "AR": "es", "CO": "es", "PE": "es", "CL": "es",
        "MY": "ms", "SG": "en", "HK": "zh-Hant", "TW": "zh-TW", "CN": "zh",
        "IN": "hi", "PK": "ur", "BD": "bn", "LK": "si", "NP": "ne",
        "AE": "ar", "SA": "ar", "EG": "ar", "MA": "ar", "IQ": "ar",
        "IL": "he", "IR": "fa", "AZ": "az", "KZ": "kk", "UZ": "uz",
        "BY": "be", "UA": "uk", "MD": "ro", "BA": "bs", "RS": "sr",
        "HR": "hr", "SI": "sl", "SK": "sk", "CZ": "cs", "HU": "hu",
        "RO": "ro", "BG": "bg", "GR": "el", "CY": "el", "MT": "mt",
        "IS": "is", "NO": "nb", "SE": "sv", "FI": "fi", "DK": "da",
        "NL": "nl", "IE": "en", "LU": "lb", "EE": "et", "LV": "lv",
        "LT": "lt", "PL": "pl", "RU": "ru", "AM": "hy", "GE": "ka",
        "MN": "mn", "KH": "km", "LA": "lo", "TH": "th", "VN": "vi",
        "ID": "id", "PH": "fil", "MM": "my", "KR": "ko", "JP": "ja",
        "TR": "tr",
    }
    for name in names:
        if name.startswith(".") or "_" not in name:
            continue
        lang, cc = name.split("_", 1)
        cc = cc.upper()
        if len(cc) != 2 or not cc.isalpha():
            continue
        if cc in preferred:
            cc_lang[cc] = preferred[cc]
        elif cc not in cc_lang:
            cc_lang[cc] = lang
    return cc_lang


@settings_bp.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(
        {
            "tmdb_api_key": get_setting("tmdb_api_key") or "",
            "telegram_bot_token": get_setting("telegram_bot_token") or "",
            "telegram_chat_id": get_setting("telegram_chat_id") or "",
            "notify_hour": get_setting("notify_hour") or "09:00",
            "notification_hour": get_setting("notification_hour") or "09:05",
            "sync_hour": get_setting("sync_hour") or "09:00",
            "genre_hour": get_setting("genre_hour") or "05:00",
            "data_hour": get_setting("data_hour") or "05:10",
            "anime_notification_hour": get_setting("anime_notification_hour") or "09:05",
            "rec_hour": get_setting("rec_hour") or "05:25",
            "backup_hour": get_setting("backup_hour") or "03:00",
            "backup_mode": get_setting("backup_mode") or "",
            "backup_rsync_host": get_setting("backup_rsync_host") or "",
            "backup_rsync_port": get_setting("backup_rsync_port") or "",
            "backup_rsync_path": get_setting("backup_rsync_path") or "",
            "backup_rsync_user": get_setting("backup_rsync_user") or "",
            "has_backup_rsync_pass": bool(get_setting("backup_rsync_pass")),
            "has_backup_key": bool(get_setting("backup_rsync_key")),
            "backup_samba_host": get_setting("backup_samba_host") or "",
            "backup_samba_port": get_setting("backup_samba_port") or "",
            "backup_samba_share": get_setting("backup_samba_share") or "",
            "backup_samba_user": get_setting("backup_samba_user") or "",
            "has_backup_samba_pass": bool(get_setting("backup_samba_pass")),
            "timezone": get_setting("timezone") or "Europe/Istanbul",
            "language": get_setting("language") or "tr-TR",
            "ntfy_topic": get_setting("ntfy_topic") or "",
            "telegram_enabled": get_setting("telegram_enabled") or "1",
            "ntfy_enabled": get_setting("ntfy_enabled") or "1",
            "notif_center_enabled": get_setting("notif_center_enabled") or "1",
            "notif_center_time": get_setting("notif_center_time") or "relative",
            "notif_center_poster": get_setting("notif_center_poster") or "1",
            "notif_center_hide_read": get_setting("notif_center_hide_read") or "0",
            "notif_center_limit": get_setting("notif_center_limit") or "50",
            "discord_enabled": get_setting("discord_enabled") or "1",
            "discord_webhook_url": get_setting("discord_webhook_url") or "",
            "email_enabled": get_setting("email_enabled") or "1",
            "brevo_api_key": get_setting("brevo_api_key") or "",
            "email_from": get_setting("email_from") or "",
            "email_to": get_setting("email_to") or "",
            "email_provider": get_setting("email_provider") or "brevo",
            "smtp_preset": get_setting("smtp_preset") or "",
            "smtp_host": get_setting("smtp_host") or "",
            "smtp_port": get_setting("smtp_port") or "",
            "smtp_user": get_setting("smtp_user") or "",
            "has_smtp_pass": bool(get_setting("smtp_pass")),
            "cache_ttl": get_setting("cache_ttl") or "3600",
            "server_today": today_str(),
            **{f"notif_{k}": get_setting(f"notif_{k}") or "1" for k, _g in NOTIF_TYPES},
        }
    )


@settings_bp.route("/api/settings", methods=["POST"])
def save_settings():
    body = request.get_json()
    # gecersiz timezone DB'ye yazilip scheduler'i bozmasin
    if "timezone" in body:
        tz_val = str(body.get("timezone") or "").strip()
        if tz_val and tz_val not in zoneinfo.available_timezones():
            return jsonify({"error": "gecersiz timezone"}), 400
    # bildirim merkezi tarih modu yalnizca iki deger alabilir
    if "notif_center_time" in body and str(body.get("notif_center_time")) not in ("relative", "absolute"):
        return jsonify({"error": "gecersiz tarih formati"}), 400
    if "notif_center_limit" in body:
        try:
            if int(body.get("notif_center_limit")) not in (20, 50, 100):
                return jsonify({"error": "gecersiz liste boyutu"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "gecersiz liste boyutu"}), 400
    for key in (
        "tmdb_api_key",
        "telegram_bot_token",
        "telegram_chat_id",
        "notify_hour",
        "notification_hour",
        "sync_hour",
        "genre_hour",
        "data_hour",
        "anime_notification_hour",
        "rec_hour",
        "backup_hour",
        "backup_mode",
        "backup_rsync_host",
        "backup_rsync_port",
        "backup_rsync_path",
        "backup_rsync_user",
        "backup_samba_host",
        "backup_samba_port",
        "backup_samba_share",
        "backup_samba_user",
        "timezone",
        "language",
        "ntfy_topic",
        "telegram_enabled",
        "ntfy_enabled",
        "notif_center_enabled",
        "notif_center_time",
        "notif_center_poster",
        "notif_center_hide_read",
        "notif_center_limit",
        "discord_enabled",
        "discord_webhook_url",
        "email_enabled",
        "brevo_api_key",
        "email_from",
        "email_to",
        "email_provider",
        "smtp_preset",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "cache_ttl",
        *(f"notif_{k}" for k, _g in NOTIF_TYPES),
    ):
        if key in body:
            set_setting(key, str(body[key] or ""))
    if "smtp_pass" in body:
        val = (body.get("smtp_pass") or "").strip()
        # bos deger -> mevcut sifre korunur; sadece yeni girilen deger sifrelenir
        if val:
            set_setting("smtp_pass", encrypt_secret(val))
    for sec_key in ("backup_rsync_pass", "backup_samba_pass", "backup_rsync_key"):
        if sec_key in body:
            v = (body.get(sec_key) or "").strip()
            if v and v != "••••••••":
                set_setting(sec_key, encrypt_secret(v))
            elif v == "":
                # temizle isteği
                set_setting(sec_key, "")
    if "cache_ttl" in body:
        try:
            from ramcache import list_cache
            list_cache.configure(int(body["cache_ttl"] or 0))
        except (TypeError, ValueError):
            pass
    if any(k in body for k in ("notify_hour", "notification_hour", "sync_hour", "genre_hour", "data_hour", "anime_notification_hour", "rec_hour", "backup_hour", "timezone")):
        schedule_releases()
    return jsonify({"ok": True})


PROVIDER_LABELS = {
    "gmail": "Gmail", "outlook": "Outlook/Hotmail", "yahoo": "Yahoo",
    "yandex": "Yandex", "icloud": "iCloud", "zoho": "Zoho",
    "other": "E-Posta sunucusu", "brevo": "Brevo",
}


@settings_bp.route("/api/backup/run", methods=["POST"])
def backup_run():
    mode = (get_setting("backup_mode") or "").strip()
    if not mode:
        return jsonify({"error": "Yedekleme modu seçili değil"}), 400
    body = request.get_json(silent=True) or {}
    target = (body.get("target") or "").strip().lower()
    # Hedef belirtilmemişse doluluğa göre çıkarım
    if target not in ("rsync", "samba"):
        rsync_host = (get_setting("backup_rsync_host") or "").strip()
        samba_host = (get_setting("backup_samba_host") or "").strip()
        samba_share = (get_setting("backup_samba_share") or "").strip()
        rsync_dolu = bool(rsync_host)
        samba_dolu = bool(samba_host and samba_share)
        if rsync_dolu and not samba_dolu:
            target = "rsync"
        elif samba_dolu and not rsync_dolu:
            target = "samba"
        else:
            return jsonify({"error": "Hedef seçili değil"}), 400
    # Hedefe göre doluluk kontrolü
    if target == "rsync":
        host = (get_setting("backup_rsync_host") or "").strip()
        if not host:
            return jsonify({"error": "Uzak IP gerekli"}), 400
    else:
        host = (get_setting("backup_samba_host") or "").strip()
        share = (get_setting("backup_samba_share") or "").strip()
        if not (host and share):
            return jsonify({"error": "Uzak IP ve paylaşılan klasör gerekli"}), 400
    # son hedefi kaydet (cron için)
    try:
        set_setting("backup_last_target", target)
    except Exception:
        pass
    try:
        print(f"backup_run start mode={mode} target={target} host={host if target=='rsync' else host}", flush=True)
    except Exception:
        pass
    # Kaynak dosyayı hazırla (anında)
    import tempfile, tarfile, shutil, subprocess, datetime, stat
    from config import DB_PATH, BASE_DIR
    import os
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp_path = None
    try:
        if mode == "db":
            if not os.path.exists(DB_PATH):
                return jsonify({"error": "DB dosyası bulunamadı"}), 400
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db", prefix=f"nextep-{ts}-")
            os.close(tmp_fd)
            shutil.copy2(DB_PATH, tmp_path)
            remote_name = f"nextep-{ts}.db"
        else:
            # full -> tar.gz
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".tar.gz", prefix=f"nextep-full-{ts}-")
            os.close(tmp_fd)
            # klasörleri topla, venv/__pycache__/.git/bak/backup/md hariç
            exclude_dirs = {"venv", "__pycache__", ".git", "bak", "backup", "tmp_push", ".opencode", "md"}
            exclude_files = {".smtp_secret"}
            with tarfile.open(tmp_path, "w:gz") as tf:
                for root, dirs, files in os.walk(BASE_DIR):
                    # exclude dirs in-place
                    dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith(".")]
                    for fn in files:
                        if fn in exclude_files:
                            continue
                        if fn.endswith(".bak"):
                            continue
                        full = os.path.join(root, fn)
                        arc = os.path.relpath(full, BASE_DIR)
                        try:
                            tf.add(full, arcname=arc)
                        except Exception:
                            continue
            remote_name = f"nextep-full-{ts}.tar.gz"
        # Hedefe yolla
        if target == "rsync":
            host = (get_setting("backup_rsync_host") or "").strip()
            port = (get_setting("backup_rsync_port") or "22").strip() or "22"
            path = (get_setting("backup_rsync_path") or "/tmp/").strip() or "/tmp/"
            user = (get_setting("backup_rsync_user") or "root").strip() or "root"
            # key veya pass çöz
            key_enc = get_setting("backup_rsync_key") or ""
            key_plain = ""
            if key_enc:
                try:
                    key_plain = decrypt_secret(key_enc) or ""
                except Exception:
                    key_plain = ""
            pass_enc = get_setting("backup_rsync_pass") or ""
            pass_plain = ""
            if pass_enc:
                try:
                    pass_plain = decrypt_secret(pass_enc) or ""
                except Exception:
                    pass_plain = ""
            # remote tam yol
            if not path.endswith("/"):
                path = path + "/"
            remote = f"{user}@{host}:{path}{remote_name}"
            # scp komutunu kur
            # key varsa temp key dosyası
            key_file = None
            try:
                cmd = ["scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-P", str(port)]
                if key_plain and "PRIVATE KEY" in key_plain:
                    kfd, key_file = tempfile.mkstemp(prefix="bk_key_")
                    os.close(kfd)
                    with open(key_file, "w") as kf:
                        kf.write(key_plain)
                    os.chmod(key_file, 0o600)
                    cmd.extend(["-i", key_file])
                cmd.extend([tmp_path, remote])
                # pass varsa sshpass kullan (yoksa key'e güvenir)
                if pass_plain and not key_file:
                    # sshpass yoksa hata döndürme, scp parola sorar ve takılır — engelle
                    # bu durumda hata ver
                    return jsonify({"error": "SSH key gerekli (parola ile yedek için key kullanın)"}), 400
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if proc.returncode != 0:
                    err = (proc.stderr or proc.stdout or "scp hatası").strip()[:500]
                    try:
                        print(f"backup_run rsync fail {err}", flush=True)
                    except Exception:
                        pass
                    return jsonify({"error": f"Rsync yedek hatası: {err}"}), 500
                try:
                    sz = os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0
                    print(f"backup_run rsync ok {remote_name} size={sz} -> {host}:{path}", flush=True)
                except Exception:
                    pass
                # per-mode 30 budama (yeni yedek basarili -> en eskileri sil)
                try:
                    _prune_remote_rsync(host, port, path, user, key_plain, mode)
                except Exception:
                    pass
            finally:
                if key_file and os.path.exists(key_file):
                    try:
                        os.unlink(key_file)
                    except Exception:
                        pass
        else:
            # samba -> smbclient
            host = (get_setting("backup_samba_host") or "").strip()
            share = (get_setting("backup_samba_share") or "").strip()
            port = (get_setting("backup_samba_port") or "445").strip() or "445"
            user = (get_setting("backup_samba_user") or "").strip()
            pass_enc = get_setting("backup_samba_pass") or ""
            pass_plain = ""
            if pass_enc:
                try:
                    pass_plain = decrypt_secret(pass_enc) or ""
                except Exception:
                    pass_plain = ""
            # in-app Samba (SMB2/3) via smbprotocol only (B) — smbclient kullanılmaz
            smb_ok = False
            last_err = ""
            try:
                from smbprotocol.connection import Connection
                from smbprotocol.session import Session
                from smbprotocol.tree import TreeConnect
                from smbprotocol.open import Open, CreateDisposition, FileAttributes, ShareAccess, ImpersonationLevel, CreateOptions, FilePipePrinterAccessMask
                import uuid
                conn = Connection(uuid.uuid4(), host, int(port))
                conn.connect(timeout=10)
                try:
                    sess = Session(conn, username=user, password=pass_plain)
                    sess.connect()
                    tree = TreeConnect(sess, f"\\\\{host}\\{share}")
                    tree.connect()
                    # dosya olustur / uzerine yaz (READ|WRITE — tek WRITE bazi sunucularda ACCESS_DENIED verir)
                    fd = Open(tree, remote_name)
                    fd.create(ImpersonationLevel.Impersonation, FilePipePrinterAccessMask.GENERIC_READ | FilePipePrinterAccessMask.GENERIC_WRITE, FileAttributes.FILE_ATTRIBUTE_NORMAL, ShareAccess.FILE_SHARE_WRITE, CreateDisposition.FILE_OVERWRITE_IF, CreateOptions.FILE_NON_DIRECTORY_FILE)
                    try:
                        # max_write_size pazarlik sonrasi belli olur (genelde 1MiB), asarsak SMBException
                        max_sz = getattr(conn, "max_write_size", 0) or (1024 * 1024)
                        chunk_sz = min(1024 * 1024, max_sz)
                        with open(tmp_path, "rb") as lfd:
                            offset = 0
                            while True:
                                data = lfd.read(chunk_sz)
                                if not data:
                                    break
                                fd.write(data, offset)
                                offset += len(data)
                    finally:
                        fd.close()
                    tree.disconnect()
                    sess.disconnect()
                    conn.disconnect()
                    smb_ok = True
                except Exception as e2:
                    last_err = str(e2).strip()[:800]
                    try:
                        conn.disconnect()
                    except Exception:
                        pass
                    raise
            except Exception as e:
                if not last_err:
                    last_err = str(e).strip()[:800]
            if not smb_ok:
                try:
                    print(f"backup_run samba fail {last_err or 'bilinmeyen'}", flush=True)
                except Exception:
                    pass
                return jsonify({"error": f"Samba yedek hatası: {last_err or 'bilinmeyen'}"}), 500
            try:
                sz2 = os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0
                print(f"backup_run samba ok {remote_name} size={sz2} -> \\\\{host}\\{share}", flush=True)
            except Exception:
                pass
            # per-mode 30 budama (yeni yedek basarili -> en eskileri sil)
            try:
                _prune_remote_samba(host, port, share, user, pass_plain, mode)
            except Exception:
                pass
        if mode == "db":
            msg = f"Database {target.capitalize()} ile Yedeklendi"
        else:
            msg = f"{target.capitalize()} ile Full Yedek Alındı"
        try:
            print(f"backup_run done mode={mode} target={target} {msg}", flush=True)
        except Exception:
            pass
        return jsonify({"ok": True, "msg": msg, "target": target})
    except subprocess.TimeoutExpired:
        try:
            print("backup_run fail timeout", flush=True)
        except Exception:
            pass
        return jsonify({"error": "Yedek zaman aşımı"}), 500
    except Exception as e:
        try:
            print(f"backup_run fail {e}", flush=True)
        except Exception:
            pass
        return jsonify({"error": f"Yedek hatası: {e}"}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@settings_bp.route("/api/backup/restore", methods=["POST"])
def backup_restore():
    mode = (get_setting("backup_mode") or "").strip()
    if not mode:
        return jsonify({"error": "Yedekleme modu seçili değil"}), 400
    body = request.get_json(silent=True) or {}
    target = (body.get("target") or "").strip().lower()
    if target not in ("rsync", "samba"):
        rsync_host = (get_setting("backup_rsync_host") or "").strip()
        samba_host = (get_setting("backup_samba_host") or "").strip()
        samba_share = (get_setting("backup_samba_share") or "").strip()
        rsync_dolu = bool(rsync_host)
        samba_dolu = bool(samba_host and samba_share)
        if rsync_dolu and not samba_dolu:
            target = "rsync"
        elif samba_dolu and not rsync_dolu:
            target = "samba"
        else:
            return jsonify({"error": "Hedef seçili değil"}), 400
    if target == "rsync":
        host = (get_setting("backup_rsync_host") or "").strip()
        if not host:
            return jsonify({"error": "Uzak IP gerekli"}), 400
    else:
        host = (get_setting("backup_samba_host") or "").strip()
        share = (get_setting("backup_samba_share") or "").strip()
        if not (host and share):
            return jsonify({"error": "Uzak IP ve paylaşılan klasör gerekli"}), 400
    try:
        set_setting("backup_last_target", target)
    except Exception:
        pass
    try:
        print(f"backup_restore start mode={mode} target={target}", flush=True)
    except Exception:
        pass
    # restore hep gecici klasore, canli /etc/nextep ezilmez
    import tempfile, tarfile, shutil, subprocess, datetime, os, sqlite3
    from config import BASE_DIR
    restore_root = os.path.join(BASE_DIR, "restore")
    try:
        os.makedirs(restore_root, exist_ok=True)
    except Exception as e:
        return jsonify({"error": f"Restore klasoru olusturulamadi: {e}"}), 500
    tmp_path = None
    remote_name = None
    try:
        # --- en son yedegi bul ve indir (fail-soft) ---
        if target == "samba":
            s_host = (get_setting("backup_samba_host") or "").strip()
            s_share = (get_setting("backup_samba_share") or "").strip()
            s_port = (get_setting("backup_samba_port") or "445").strip() or "445"
            s_user = (get_setting("backup_samba_user") or "").strip()
            s_pass_enc = get_setting("backup_samba_pass") or ""
            s_pass = ""
            if s_pass_enc:
                try:
                    s_pass = decrypt_secret(s_pass_enc) or ""
                except Exception:
                    s_pass = ""
            # list + pick latest
            try:
                import uuid
                from smbprotocol.connection import Connection
                from smbprotocol.session import Session
                from smbprotocol.tree import TreeConnect
                from smbprotocol.open import Open, CreateDisposition, FileAttributes, ShareAccess, ImpersonationLevel, CreateOptions, DirectoryAccessMask, FilePipePrinterAccessMask
                from smbprotocol.file_info import FileInformationClass
                conn = Connection(uuid.uuid4(), s_host, int(s_port))
                conn.connect(timeout=10)
                try:
                    sess = Session(conn, username=s_user, password=s_pass)
                    sess.connect()
                    tree = TreeConnect(sess, f"\\\\{s_host}\\{s_share}")
                    tree.connect()
                    # dizin listele
                    fd_dir = Open(tree, "")
                    fd_dir.create(ImpersonationLevel.Impersonation, DirectoryAccessMask.FILE_LIST_DIRECTORY, FileAttributes.FILE_ATTRIBUTE_DIRECTORY, ShareAccess.FILE_SHARE_READ, CreateDisposition.FILE_OPEN, CreateOptions.FILE_DIRECTORY_FILE)
                    try:
                        files = fd_dir.query_directory("*", FileInformationClass.FILE_DIRECTORY_INFORMATION)
                    finally:
                        fd_dir.close()
                    # filtrele
                    cand = []
                    for f in files:
                        name = f["file_name"].get_value().decode("utf-16-le").rstrip("\x00")
                        if mode == "db" and name.startswith("nextep-") and name.endswith(".db"):
                            cand.append(name)
                        elif mode != "db" and name.startswith("nextep-full-") and name.endswith(".tar.gz"):
                            cand.append(name)
                    if not cand:
                        tree.disconnect(); sess.disconnect(); conn.disconnect()
                        return jsonify({"error": "Uzakta yedek bulunamadi"}), 404
                    cand.sort(reverse=True)
                    remote_name = cand[0]
                    # indir
                    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db" if mode == "db" else ".tar.gz", prefix="nextep-restore-")
                    os.close(tmp_fd)
                    fd = Open(tree, remote_name)
                    fd.create(ImpersonationLevel.Impersonation, FilePipePrinterAccessMask.GENERIC_READ, FileAttributes.FILE_ATTRIBUTE_NORMAL, ShareAccess.FILE_SHARE_READ, CreateDisposition.FILE_OPEN, CreateOptions.FILE_NON_DIRECTORY_FILE)
                    try:
                        max_sz = getattr(conn, "max_read_size", 0) or (1024 * 1024)
                        chunk = min(1024 * 1024, max_sz)
                        offset = 0
                        with open(tmp_path, "wb") as out:
                            while True:
                                data = fd.read(offset, chunk)
                                if not data:
                                    break
                                out.write(data)
                                offset += len(data)
                                if len(data) < chunk:
                                    break
                    finally:
                        fd.close()
                    tree.disconnect(); sess.disconnect(); conn.disconnect()
                except Exception:
                    try:
                        conn.disconnect()
                    except Exception:
                        pass
                    raise
            except Exception as e:
                return jsonify({"error": f"Samba geri yukleme hatasi: {str(e).strip()[:800]}"}), 500
        else:
            # rsync -> scp pull
            r_host = (get_setting("backup_rsync_host") or "").strip()
            r_port = (get_setting("backup_rsync_port") or "22").strip() or "22"
            r_path = (get_setting("backup_rsync_path") or "/tmp/").strip() or "/tmp/"
            r_user = (get_setting("backup_rsync_user") or "root").strip() or "root"
            r_key_enc = get_setting("backup_rsync_key") or ""
            r_key = ""
            if r_key_enc:
                try:
                    r_key = decrypt_secret(r_key_enc) or ""
                except Exception:
                    r_key = ""
            if not r_path.endswith("/"):
                r_path += "/"
            # en son dosyayi bul: ls -t
            key_file = None
            try:
                list_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-p", str(r_port)]
                if r_key and "PRIVATE KEY" in r_key:
                    kfd, key_file = tempfile.mkstemp(prefix="bk_key_")
                    os.close(kfd)
                    with open(key_file, "w") as kf:
                        kf.write(r_key)
                    os.chmod(key_file, 0o600)
                    list_cmd.extend(["-i", key_file])
                list_cmd.extend([f"{r_user}@{r_host}", f"ls -1t {r_path} 2>/dev/null | head -n 50"])
                proc = subprocess.run(list_cmd, capture_output=True, text=True, timeout=20)
                if proc.returncode != 0:
                    return jsonify({"error": f"Rsync liste hatasi: {(proc.stderr or proc.stdout).strip()[:500]}"}), 500
                lines = [l.strip() for l in (proc.stdout or "").splitlines() if l.strip()]
                cand = []
                for ln in lines:
                    base = os.path.basename(ln.strip())
                    if not base:
                        base = ln.strip().split("/")[-1]
                    if mode == "db" and base.startswith("nextep-") and base.endswith(".db"):
                        cand.append(base)
                    elif mode != "db" and base.startswith("nextep-full-") and base.endswith(".tar.gz"):
                        cand.append(base)
                if not cand:
                    return jsonify({"error": "Uzakta yedek bulunamadi"}), 404
                # ls -t zaten yeniden eskiye, ilk uygun yeterli ama sirala da
                remote_name = cand[0]
                remote_full = f"{r_path}{remote_name}"
                # indir
                tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db" if mode == "db" else ".tar.gz", prefix="nextep-restore-")
                os.close(tmp_fd)
                pull_cmd = ["scp", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-P", str(r_port)]
                if key_file:
                    pull_cmd.extend(["-i", key_file])
                pull_cmd.extend([f"{r_user}@{r_host}:{remote_full}", tmp_path])
                proc2 = subprocess.run(pull_cmd, capture_output=True, text=True, timeout=60)
                if proc2.returncode != 0:
                    return jsonify({"error": f"Rsync indirme hatasi: {(proc2.stderr or proc2.stdout).strip()[:500]}"}), 500
            except Exception as e:
                return jsonify({"error": f"Rsync geri yukleme hatasi: {str(e).strip()[:800]}"}), 500
            finally:
                if key_file and os.path.exists(key_file):
                    try:
                        os.unlink(key_file)
                    except Exception:
                        pass
        # --- dogrulama (fail-soft, sistem cokmez) ---
        if not tmp_path or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            return jsonify({"error": "Indirilen yedek bos veya eksik"}), 500
        if mode == "db":
            try:
                conn_sql = sqlite3.connect(tmp_path)
                cur = conn_sql.cursor()
                cur.execute("PRAGMA integrity_check;")
                row = cur.fetchone()
                conn_sql.close()
                if not row or row[0] != "ok":
                    return jsonify({"error": f"DB butunluk hatasi: {row}"}), 500
            except Exception as e:
                return jsonify({"error": f"DB dogrulama hatasi: {str(e).strip()[:500]}"}), 500
        else:
            if not tarfile.is_tarfile(tmp_path):
                return jsonify({"error": "Tar dosyasi bozuk"}), 500
            try:
                with tarfile.open(tmp_path, "r:gz") as tf:
                    members = tf.getmembers()
                    if not members:
                        return jsonify({"error": "Tar icerigi bos"}), 500
            except Exception as e:
                return jsonify({"error": f"Tar dogrulama hatasi: {str(e).strip()[:500]}"}), 500
        # --- gecici klasore ac ---
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_remote = (remote_name or f"restore-{ts}").replace("/", "_")
        restore_dir = os.path.join(restore_root, f"restore_{ts}_{target}_{mode}_{safe_remote}")
        try:
            os.makedirs(restore_dir, exist_ok=True)
        except Exception as e:
            return jsonify({"error": f"Restore klasoru olusturulamadi: {e}"}), 500
        try:
            if mode == "db":
                dest = os.path.join(restore_dir, "nextep.db")
                shutil.copy2(tmp_path, dest)
                files = ["nextep.db"]
            else:
                exclude_dirs = {"venv", "__pycache__", ".git", "bak", "backup", "tmp_push", ".opencode", "restore", "md"}
                exclude_files = {".smtp_secret"}
                files = []
                with tarfile.open(tmp_path, "r:gz") as tf:
                    for m in tf.getmembers():
                        # guvenli extract: sadece restore_dir altina
                        name = m.name.lstrip("/")
                        if not name:
                            continue
                        parts = name.split("/")
                        if parts[0] in exclude_dirs:
                            continue
                        if os.path.basename(name) in exclude_files or name.endswith(".bak"):
                            continue
                        # tar extract
                        tf.extract(m, path=restore_dir)
                        files.append(name)
                    if not files:
                        return jsonify({"error": "Tar icerigi filtre sonrasi bos"}), 500
        except Exception as e:
            return jsonify({"error": f"Restore yazma hatasi: {str(e).strip()[:800]}"}), 500
        if mode == "db":
            msg = f"Database {target.capitalize()} ile Geri Yuklendi -> {restore_dir}"
        else:
            msg = f"{target.capitalize()} ile Full Geri Yukleme Acildi -> {restore_dir}"
        try:
            print(f"backup_restore done {restore_dir} files={len(files)}", flush=True)
        except Exception:
            pass
        # per-mode 30 budama (yeni restore basarili -> en eskileri sil)
        try:
            _prune_local_restores()
        except Exception:
            pass
        return jsonify({"ok": True, "msg": msg, "target": target, "mode": mode, "restore_path": restore_dir, "files": files[:50], "remote_name": remote_name})
    except Exception as e:
        try:
            print(f"backup_restore fail {e}", flush=True)
        except Exception:
            pass
        return jsonify({"error": f"Geri yukleme hatasi: {str(e).strip()[:800]}"}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@settings_bp.route("/api/settings/test", methods=["POST"])
def test_settings():
    body = request.get_json(silent=True) or {}
    channel = (body.get("channel") or "").strip().lower()
    token = (body.get("telegram_bot_token") or "").strip() or (get_setting("telegram_bot_token") or "").strip()
    chat_id = (body.get("telegram_chat_id") or "").strip() or (get_setting("telegram_chat_id") or "").strip()
    ntfy_topic = (body.get("ntfy_topic") or "").strip() or (get_setting("ntfy_topic") or "").strip()
    discord_url = (body.get("discord_webhook_url") or "").strip() or (get_setting("discord_webhook_url") or "").strip()
    brevo_api_key = (body.get("brevo_api_key") or "").strip() or (get_setting("brevo_api_key") or "").strip()
    email_from = (body.get("email_from") or "").strip() or (get_setting("email_from") or "").strip()
    email_to = (body.get("email_to") or "").strip() or (get_setting("email_to") or "").strip()
    provider = (body.get("email_provider") or get_setting("email_provider") or "brevo").strip() or "brevo"
    smtp_host = (body.get("smtp_host") or "").strip() or (get_setting("smtp_host") or "").strip()
    smtp_port = (body.get("smtp_port") or "").strip() or (get_setting("smtp_port") or "").strip()
    smtp_user = (body.get("smtp_user") or "").strip() or (get_setting("smtp_user") or "").strip()
    smtp_pass_plain = body.get("smtp_pass") or ""
    stored_pass = get_setting("smtp_pass") or ""
    sample_card = {
        "title": "Örnek Dizi",
        "media_type": "tv",
        "score": 8.1,
        "platform": "Netflix",
        "status_line": "S01E01 · Bugün Yayınlanacak",
        "poster_url": "https://image.tmdb.org/t/p/w500/gMYZZvnkVNTqSVnVCphWbPXwWwb.jpg",
    }

    if channel == "telegram":
        if not (token and chat_id):
            return jsonify({"error": "Telegram bot token ve chat ID gereklidir"}), 400
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": t("test_message")},
            timeout=15,
        )
        if r.status_code != 200:
            try:
                err = r.json().get("description", "Bilinmeyen hata")
            except Exception:
                err = "Bilinmeyen hata"
            return jsonify({"error": f"Telegram hatası: {err}"}), 400
    elif channel == "ntfy":
        if not ntfy_topic:
            return jsonify({"error": "ntfy konusu gereklidir"}), 400
        r = requests.post(
            f"https://ntfy.sh/{ntfy_topic_clean(ntfy_topic)}",
            data=t("test_message"),
            timeout=15,
        )
        if r.status_code != 200:
            return jsonify({"error": f"ntfy hatası: HTTP {r.status_code}"}), 400
    elif channel == "discord":
        if not discord_url.startswith("https://discord.com/api/webhooks/"):
            return jsonify({"error": "Geçerli Discord webhook adresi gereklidir"}), 400
        try:
            r = requests.post(
                discord_url,
                json={"content": t("test_message")},
                timeout=15,
            )
            if r.status_code not in (200, 204):
                try:
                    err = r.json().get("message", "Bilinmeyen hata")
                except Exception:
                    err = "Bilinmeyen hata"
                return jsonify({"error": f"Discord hatası: {err}"}), 400
        except Exception as e:
            return jsonify({"error": f"Discord hatası: {e}"}), 400
    elif channel == "email":
        prov_label = PROVIDER_LABELS.get(provider, "E-Posta")
        if provider == "brevo":
            if not (brevo_api_key and email_from and email_to):
                return jsonify({"error": "Brevo API anahtarı, gönderen ve alıcı e-posta gereklidir"}), 400
            try:
                r = requests.post(
                    "https://api.brevo.com/v3/smtp/email",
                    json={
                        "sender": {"name": "NextEp", "email": email_from},
                        "to": [{"email": email_to}],
                        "subject": t("test_message"),
                        "textContent": t("test_message"),
                        "htmlContent": _email_card_html(sample_card),
                    },
                    headers={
                        "api-key": brevo_api_key,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    timeout=20,
                )
                if r.status_code not in (200, 201):
                    return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
            except Exception as e:
                return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
        else:
            password = smtp_pass_plain or decrypt_secret(stored_pass)
            if not (smtp_host and smtp_port and smtp_user and password and email_from and email_to):
                return jsonify({"error": "SMTP bilgileri eksik"}), 400
            try:
                ok = _send_generic_smtp(
                    t("test_message"), None,
                    host=smtp_host, port_raw=smtp_port, user=smtp_user, password=password,
                    email_from=email_from, email_to=email_to, card=sample_card,
                )
                if not ok:
                    return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
            except Exception as e:
                return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400

    return jsonify({"ok": True})


@settings_bp.route("/api/fav_genres", methods=["GET", "POST"])
def fav_genres():
    if request.method == "GET":
        raw = get_setting("fav_genres")
        genres = json.loads(raw) if raw else []
        return jsonify({"genres": genres})
    body = request.get_json(silent=True) or {}
    genre = (body.get("genre") or "").strip()
    if not genre:
        return jsonify({"error": "Tür adı gerekli"}), 400
    raw = get_setting("fav_genres")
    genres = json.loads(raw) if raw else []
    if genre in genres:
        genres.remove(genre)
        added = False
    else:
        genres.append(genre)
        added = True
    set_setting("fav_genres", json.dumps(genres, ensure_ascii=False))
    bump()
    try:
        from fav_listings import invalidate_fav_listing
        invalidate_fav_listing("genre", genre.lower() + "|all")
        invalidate_fav_listing("genre", genre.lower() + "|tv")
        invalidate_fav_listing("genre", genre.lower() + "|movie")
    except Exception:
        pass
    return jsonify({"ok": True, "added": added, "genres": genres})


@settings_bp.route("/api/fav_anime_genres", methods=["GET", "POST"])
def fav_anime_genres():
    if request.method == "GET":
        raw = get_setting("fav_anime_genres")
        genres = json.loads(raw) if raw else []
        return jsonify({"genres": genres})
    body = request.get_json(silent=True) or {}
    genre = (body.get("genre") or "").strip()
    if not genre:
        return jsonify({"error": "Tür adı gerekli"}), 400
    raw = get_setting("fav_anime_genres")
    genres = json.loads(raw) if raw else []
    if genre in genres:
        genres.remove(genre)
        added = False
    else:
        genres.append(genre)
        added = True
    set_setting("fav_anime_genres", json.dumps(genres, ensure_ascii=False))
    bump()
    return jsonify({"ok": True, "added": added, "genres": genres})


@settings_bp.route("/api/genres")
def list_genres():
    source = request.args.get("source", "tmdb")
    if source == "anilist":
        return jsonify({"genres": _anilist_genre_names()})
    return jsonify({"genres": _tmdb_genre_names()})