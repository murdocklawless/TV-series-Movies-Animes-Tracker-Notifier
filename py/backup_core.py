"""Ortak yedekleme çekirdeği: artifact üretimi + rsync/samba gönderimi + uzak budama.

Kullananlar:
- Manuel endpoint: routes/settings.py::backup_run (tek hedef + backup_last_target kaydı)
- Otomatik cron: scheduler.py::backup_job (dolu olan TÜM hedeflere gönderim)

Davranış farkı yalnız hedef seçiminde; gönderim mantığı tek kaynaktan gelir.
Tüm fonksiyonlar fail-soft tasarlanır: hata (ok, mesaj) ikilisiyle döner,
asla çağıranı patlatmaz (artifact üretimindeki kritik hata hariç).
"""

import os

from db import get_setting
from crypto_util import decrypt_secret

# Yedek sinirlari — per-mode 30 (db 30 + full 30 = hedef basina 60)
MAX_BACKUPS_DB = 30
MAX_BACKUPS_FULL = 30


def resolve_targets():
    """Dolu olan yedek hedeflerini listeler: [] | ["rsync"] | ["samba"] | ["rsync", "samba"]."""
    try:
        rsync_host = (get_setting("backup_rsync_host") or "").strip()
    except Exception:
        rsync_host = ""
    try:
        samba_host = (get_setting("backup_samba_host") or "").strip()
        samba_share = (get_setting("backup_samba_share") or "").strip()
    except Exception:
        samba_host, samba_share = "", ""
    targets = []
    if rsync_host:
        targets.append("rsync")
    if samba_host and samba_share:
        targets.append("samba")
    return targets


def build_artifact(mode):
    """Yedeklenecek dosyayı üretir, (tmp_path, remote_name) döner.

    mode="db" -> DB kopyası; diğer -> full tar.gz.
    DB dosyası yoksa ValueError yükseltir (çağıran 400'e çevirir).
    Dönülen tmp_path'in temizliği çağırana aittir.
    """
    import tempfile
    import tarfile
    import shutil
    import datetime

    from config import DB_PATH, BASE_DIR

    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    if mode == "db":
        if not os.path.exists(DB_PATH):
            raise ValueError("DB dosyası bulunamadı")
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db", prefix="nextep-%s-" % ts)
        os.close(tmp_fd)
        shutil.copy2(DB_PATH, tmp_path)
        remote_name = "nextep-%s.db" % ts
    else:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".tar.gz", prefix="nextep-full-%s-" % ts)
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
        remote_name = "nextep-full-%s.tar.gz" % ts
    return tmp_path, remote_name


def _decrypt(value):
    try:
        return decrypt_secret(value) or "" if value else ""
    except Exception:
        return ""


def send_rsync(tmp_path, remote_name, mode):
    """Artifact'ı rsync (scp) hedefine yollar. (ok, mesaj) döner."""
    import tempfile
    import subprocess

    host = (get_setting("backup_rsync_host") or "").strip()
    if not host:
        return False, "Uzak IP gerekli"
    port = (get_setting("backup_rsync_port") or "22").strip() or "22"
    path = (get_setting("backup_rsync_path") or "/tmp/").strip() or "/tmp/"
    user = (get_setting("backup_rsync_user") or "root").strip() or "root"
    key_plain = _decrypt(get_setting("backup_rsync_key") or "")
    pass_plain = _decrypt(get_setting("backup_rsync_pass") or "")
    if not path.endswith("/"):
        path = path + "/"
    remote = "%s@%s:%s%s" % (user, host, path, remote_name)
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
        if pass_plain and not key_file:
            # sshpass yoksa scp parola sorar ve takılır — engelle
            return False, "SSH key gerekli (parola ile yedek için key kullanın)"
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            return False, "Yedek zaman aşımı"
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "scp hatası").strip()[:500]
            try:
                print("backup rsync fail %s" % err, flush=True)
            except Exception:
                pass
            return False, "Rsync yedek hatası: %s" % err
        try:
            sz = os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0
            print("backup rsync ok %s size=%s -> %s:%s" % (remote_name, sz, host, path), flush=True)
        except Exception:
            pass
        # per-mode 30 budama (yeni yedek basarili -> en eskileri sil)
        try:
            _prune_remote_rsync(host, port, path, user, key_plain, mode)
        except Exception:
            pass
        return True, "size=%s -> %s:%s" % (
            os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0, host, path)
    finally:
        if key_file and os.path.exists(key_file):
            try:
                os.unlink(key_file)
            except Exception:
                pass


def send_samba(tmp_path, remote_name, mode):
    """Artifact'ı samba hedefine yollar (smbprotocol). (ok, mesaj) döner."""
    host = (get_setting("backup_samba_host") or "").strip()
    share = (get_setting("backup_samba_share") or "").strip()
    if not (host and share):
        return False, "Uzak IP ve paylaşılan klasör gerekli"
    port = (get_setting("backup_samba_port") or "445").strip() or "445"
    user = (get_setting("backup_samba_user") or "").strip()
    pass_plain = _decrypt(get_setting("backup_samba_pass") or "")
    smb_ok = False
    last_err = ""
    try:
        import uuid

        from smbprotocol.connection import Connection
        from smbprotocol.session import Session
        from smbprotocol.tree import TreeConnect
        from smbprotocol.open import Open, CreateDisposition, FileAttributes, ShareAccess, ImpersonationLevel, CreateOptions, FilePipePrinterAccessMask

        conn = Connection(uuid.uuid4(), host, int(port))
        conn.connect(timeout=10)
        try:
            sess = Session(conn, username=user, password=pass_plain)
            sess.connect()
            tree = TreeConnect(sess, "\\\\%s\\%s" % (host, share))
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
            print("backup samba fail %s" % (last_err or "bilinmeyen"), flush=True)
        except Exception:
            pass
        return False, "Samba yedek hatası: %s" % (last_err or "bilinmeyen")
    try:
        sz2 = os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0
        print("backup samba ok %s size=%s -> \\\\%s\\%s" % (remote_name, sz2, host, share), flush=True)
    except Exception:
        pass
    # per-mode 30 budama (yeni yedek basarili -> en eskileri sil)
    try:
        _prune_remote_samba(host, port, share, user, pass_plain, mode)
    except Exception:
        pass
    return True, "size=%s -> \\\\%s\\%s" % (
        os.path.getsize(tmp_path) if tmp_path and os.path.exists(tmp_path) else 0, host, share)


def do_backup(mode, targets):
    """Artifact'ı bir kez üretip verilen hedeflerin hepsine yollar.

    Dönüş: (results, remote_name) — results: {target: (ok, mesaj)}.
    Hedef bazında fail-soft: bir hedef patlasa diğerleri devam eder.
    tmp dosya her durumda silinir.
    """
    tmp_path, remote_name = build_artifact(mode)
    try:
        results = {}
        for target in targets:
            try:
                if target == "rsync":
                    results[target] = send_rsync(tmp_path, remote_name, mode)
                else:
                    results[target] = send_samba(tmp_path, remote_name, mode)
            except Exception as e:
                try:
                    print("backup %s fail %s" % (target, e), flush=True)
                except Exception:
                    pass
                results[target] = (False, "Yedek hatası: %s" % e)
        return results, remote_name
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


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
            cmd.extend(["%s@%s" % (user, host), "ls -1 %s 2>/dev/null" % path])
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
                print("rsync prune: mode=%s cand=%s limit=%s deleting %s: %s" % (mode, len(cand), limit, len(to_del), to_del[:3]), flush=True)
            except Exception:
                pass
            for name in to_del:
                try:
                    rm_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-p", str(port or "22")]
                    if key_file:
                        rm_cmd.extend(["-i", key_file])
                    rm_cmd.extend(["%s@%s" % (user, host), "rm -f %s%s" % (path, name)])
                    subprocess.run(rm_cmd, capture_output=True, text=True, timeout=15)
                except Exception as e:
                    try:
                        print("rsync delete failed %s: %s" % (name, e), flush=True)
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
            print("rsync prune failed: %s" % e, flush=True)
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
            tree = TreeConnect(sess, "\\\\%s\\%s" % (host, share))
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
                print("samba prune: mode=%s cand=%s limit=%s deleting %s: %s" % (mode, len(cand), limit, len(to_del), to_del[:3]), flush=True)
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
                        print("samba delete failed %s: %s" % (name, e), flush=True)
                    except Exception:
                        pass
                    continue
            tree.disconnect()
            sess.disconnect()
            conn.disconnect()
        except Exception as e:
            try:
                print("samba prune failed: %s" % e, flush=True)
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass
    except Exception as e:
        try:
            print("samba prune import/connect failed: %s" % e, flush=True)
        except Exception:
            pass
