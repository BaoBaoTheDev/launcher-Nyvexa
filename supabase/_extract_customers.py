# -*- coding: utf-8 -*-
"""Trích xuất dữ liệu khách hàng từ dump SQL Server (AZURE.sql).
Xuất: tài khoản user, số dư, game/dlc sở hữu.
"""
import re
import csv
import json
import io

SRC = r"c:\Users\Public\Downloads\launcher\supabase\AZURE.sql"
OUT_DIR = r"c:\Users\Public\Downloads\launcher\supabase"

# ─── Tokenizer cho tuple VALUES (...) của SQL Server ────────────────────────
def parse_values(s):
    """Parse một chuỗi bên trong VALUES (...) thành list giá trị Python.
    Hỗ trợ: N'...' (escape '' ), '...', NULL, số, CAST(x AS type)."""
    vals = []
    i = 0
    n = len(s)
    while i < n:
        # bỏ qua khoảng trắng và dấu phẩy
        while i < n and s[i] in " \t\r\n,":
            i += 1
        if i >= n:
            break
        # CAST(...)
        if s[i:i+4].upper() == "CAST":
            # tìm '(' ... lấy biểu thức bên trong, giá trị đầu trước ' AS '
            depth = 0
            j = i
            while j < n:
                if s[j] == '(':
                    depth += 1
                elif s[j] == ')':
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            inner = s[i+5:j-1]  # bỏ "CAST(" và ")"
            # tách phần trước " AS "
            m = re.split(r"\s+AS\s+", inner, maxsplit=1, flags=re.IGNORECASE)
            raw = m[0].strip()
            if raw.upper().startswith("N'") or raw.startswith("'"):
                raw = raw[raw.index("'")+1:]
                if raw.endswith("'"):
                    raw = raw[:-1]
                raw = raw.replace("''", "'")
            vals.append(raw)
            i = j
            continue
        # NULL
        if s[i:i+4].upper() == "NULL":
            vals.append(None)
            i += 4
            continue
        # chuỗi N'...' hoặc '...'
        if s[i] == 'N' and i+1 < n and s[i+1] == "'":
            i += 1
        if s[i] == "'":
            i += 1
            buf = []
            while i < n:
                if s[i] == "'":
                    if i+1 < n and s[i+1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                buf.append(s[i])
                i += 1
            vals.append("".join(buf))
            continue
        # số / token khác cho tới dấu phẩy ở cấp 0
        depth = 0
        buf = []
        while i < n:
            c = s[i]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c == ',' and depth == 0:
                break
            buf.append(c)
            i += 1
        vals.append("".join(buf).strip())
    return vals

# ─── Đọc các INSERT của 1 bảng, trả về list[list[value]] ────────────────────
def load_table(text, table):
    pat = re.compile(
        r"INSERT \[dbo\]\.\[" + re.escape(table) + r"\] \(([^)]*)\) VALUES \((.*)\)\s*$",
        re.IGNORECASE,
    )
    cols = None
    rows = []
    for line in text.splitlines():
        line = line.rstrip()
        if not line.startswith("INSERT [dbo].[" + table + "]"):
            continue
        m = pat.match(line)
        if not m:
            continue
        if cols is None:
            cols = [c.strip().strip("[]") for c in m.group(1).split("],")]
            cols = [c.strip("[]") for c in re.findall(r"\[([^\]]+)\]", m.group(1))]
        vals = parse_values(m.group(2))
        rows.append(vals)
    return cols, rows

def to_dicts(cols, rows):
    out = []
    for r in rows:
        d = {}
        for idx, c in enumerate(cols):
            d[c] = r[idx] if idx < len(r) else None
        out.append(d)
    return out

def main():
    with io.open(SRC, "r", encoding="utf-16", errors="replace") as f:
        text = f.read()

    pc, pr = load_table(text, "profiles")
    profiles = to_dicts(pc, pr)
    gc, gr = load_table(text, "games")
    games = to_dicts(gc, gr)
    ugc, ugr = load_table(text, "user_games")
    user_games = to_dicts(ugc, ugr)
    odc, odr = load_table(text, "owned_dlcs")
    owned_dlcs = to_dicts(odc, odr)
    usc, usr = load_table(text, "users")
    users = to_dicts(usc, usr)

    print("profiles:", len(profiles))
    print("games:", len(games))
    print("user_games:", len(user_games))
    print("owned_dlcs:", len(owned_dlcs))
    print("auth users:", len(users))

    # map game_id -> (appid, name)
    game_by_id = {g["id"]: g for g in games}

    # group games theo user
    games_by_user = {}
    for ug in user_games:
        uid = ug["user_id"]
        g = game_by_id.get(ug["game_id"])
        if g:
            games_by_user.setdefault(uid, []).append({
                "appid": g.get("appid"),
                "name": g.get("name"),
            })
        else:
            games_by_user.setdefault(uid, []).append({
                "appid": None,
                "name": "(game_id %s không tìm thấy)" % ug["game_id"],
            })

    # group dlc theo user
    dlcs_by_user = {}
    for od in owned_dlcs:
        uid = od["user_id"]
        dlcs_by_user.setdefault(uid, []).append({
            "base_appid": od.get("base_appid"),
            "dlc_appid": od.get("dlc_appid"),
            "price_vnd": od.get("purchase_price_vnd"),
        })

    # ─── Xuất JSON tổng hợp ─────────────────────────────────────────────────
    customers = []
    for p in profiles:
        uid = p["id"]
        customers.append({
            "id": uid,
            "username": p.get("username"),
            "display_name": p.get("display_name"),
            "email": p.get("email"),
            "role": p.get("role"),
            "balance": p.get("balance"),
            "is_banned": p.get("is_banned"),
            "games": games_by_user.get(uid, []),
            "dlcs": dlcs_by_user.get(uid, []),
        })

    with io.open(OUT_DIR + r"\customers_export.json", "w", encoding="utf-8") as f:
        json.dump(customers, f, ensure_ascii=False, indent=2)

    # ─── CSV 1: tài khoản + số dư ───────────────────────────────────────────
    with io.open(OUT_DIR + r"\customers_accounts.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "username", "display_name", "email", "role",
                    "balance_vnd", "is_banned", "so_game", "so_dlc"])
        for c in customers:
            w.writerow([c["id"], c["username"], c["display_name"], c["email"],
                        c["role"], c["balance"], c["is_banned"],
                        len(c["games"]), len(c["dlcs"])])

    # ─── CSV 2: game sở hữu (1 dòng / game) ─────────────────────────────────
    with io.open(OUT_DIR + r"\customers_games.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "username", "email", "game_appid", "game_name"])
        for c in customers:
            for g in c["games"]:
                w.writerow([c["id"], c["username"], c["email"], g["appid"], g["name"]])

    # ─── CSV 3: DLC sở hữu (1 dòng / dlc) ───────────────────────────────────
    with io.open(OUT_DIR + r"\customers_dlcs.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "username", "email", "base_appid", "dlc_appid", "purchase_price_vnd"])
        for c in customers:
            for d in c["dlcs"]:
                w.writerow([c["id"], c["username"], c["email"],
                            d["base_appid"], d["dlc_appid"], d["price_vnd"]])

    print("\nĐã xuất:")
    print(" - customers_export.json (tổng hợp)")
    print(" - customers_accounts.csv (tài khoản + số dư)")
    print(" - customers_games.csv (game sở hữu)")
    print(" - customers_dlcs.csv (dlc sở hữu)")

    # ─── FILE IMPORT-READY: header trùng tên cột bảng Supabase ──────────────
    # 1) profiles: id, username, display_name, email, role, balance, is_banned
    with io.open(OUT_DIR + r"\import_profiles.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "username", "display_name", "email", "role", "balance", "is_banned"])
        for p in profiles:
            banned = p.get("is_banned")
            # SQL Server bit: 1/0/None -> true/false/empty cho Postgres boolean
            if banned in ("1", 1, True):
                banned = "true"
            elif banned in ("0", 0, False):
                banned = "false"
            else:
                banned = ""
            w.writerow([
                p.get("id"), p.get("username"), p.get("display_name"),
                p.get("email"), p.get("role"),
                p.get("balance") or "0", banned,
            ])

    # 2) user_games: user_id, game_id (đúng cột bảng user_games)
    with io.open(OUT_DIR + r"\import_user_games.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "game_id", "purchased_at"])
        for ug in user_games:
            w.writerow([ug.get("user_id"), ug.get("game_id"), ug.get("purchased_at") or ""])

    # 3) owned_dlcs: user_id, base_appid, dlc_appid, purchase_price_vnd
    with io.open(OUT_DIR + r"\import_owned_dlcs.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "base_appid", "dlc_appid", "purchase_price_vnd"])
        for od in owned_dlcs:
            w.writerow([
                od.get("user_id"), od.get("base_appid"),
                od.get("dlc_appid"), od.get("purchase_price_vnd") or "0",
            ])

    print("\nFile import-ready (header trùng cột bảng):")
    print(" - import_profiles.csv -> bảng profiles")
    print(" - import_user_games.csv -> bảng user_games")
    print(" - import_owned_dlcs.csv -> bảng owned_dlcs")

    # ─── SQL hoàn chỉnh để chạy trong Supabase SQL Editor ───────────────────
    # Giải quyết lỗi FK 23503: tạo auth.users TRƯỚC, rồi profiles, rồi user_games/owned_dlcs.
    def sq(v):
        """Quote string cho SQL Postgres, trả NULL nếu None/rỗng."""
        if v is None or v == "":
            return "NULL"
        return "'" + str(v).replace("'", "''") + "'"

    def sbool(v):
        if v in ("1", 1, True):
            return "true"
        if v in ("0", 0, False):
            return "false"
        return "NULL"

    def snum(v):
        if v is None or v == "":
            return "0"
        return str(v)

    # map user_id -> email (từ profiles, fallback users)
    email_by_id = {}
    for u in users:
        if u.get("id"):
            email_by_id[u["id"]] = u.get("email")
    for p in profiles:
        if p.get("id") and p.get("email"):
            email_by_id.setdefault(p["id"], p.get("email"))

    valid_game_ids = {g["id"] for g in games}
    # map dump_game_id -> appid (để lookup game.id thật trong DB hiện tại theo appid)
    appid_by_dump_id = {g["id"]: g.get("appid") for g in games if g.get("id")}

    lines = []
    lines.append("-- ====================================================================")
    lines.append("-- Import dữ liệu khách hàng từ AZURE.sql vào Supabase (Postgres)")
    lines.append("-- Chạy TRONG Supabase SQL Editor. Thứ tự: auth.users -> profiles -> user_games/owned_dlcs")
    lines.append("-- LƯU Ý: mật khẩu cũ (định dạng v1:...) KHÔNG tương thích bcrypt của GoTrue,")
    lines.append("--        nên user được tạo với mật khẩu mặc định: Nyvexa@123 (yêu cầu user đổi/đặt lại).")
    lines.append("-- ====================================================================")
    lines.append("")
    lines.append("-- 1) auth.users (bắt buộc trước vì profiles.id -> auth.users.id)")
    lines.append("--    crypt() cần extension pgcrypto:")
    lines.append("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
    lines.append("")
    lines.append("-- Trigger handle_new_user() sẽ tự tạo profile từ raw_user_meta_data (username/display_name).")
    lines.append("-- Ta nhúng sẵn username + display_name thật vào metadata để tránh trùng username='' .")
    lines.append("-- ON CONFLICT DO NOTHING (không cột) sẽ bỏ qua mọi vi phạm unique (id HOẶC email).")
    lines.append("")
    # map id -> profile (để lấy username/display_name nhúng vào metadata)
    profile_by_id = {p.get("id"): p for p in profiles if p.get("id")}
    for u in users:
        uid = u.get("id")
        email = u.get("email")
        if not uid or not email:
            continue
        p = profile_by_id.get(uid, {})
        uname = (p.get("username") or "").replace('"', '')
        dname = (p.get("display_name") or "").replace('"', '')
        meta = '{"username":"' + uname + '","display_name":"' + dname + '"}'
        lines.append(
            "INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, "
            "email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) "
            "VALUES ("
            f"{sq(uid)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', "
            f"{sq(email)}, crypt('Nyvexa@123', gen_salt('bf')), now(), now(), now(), "
            "'{\"provider\":\"email\",\"providers\":[\"email\"]}', "
            f"{sq(meta)}) "
            "ON CONFLICT DO NOTHING;"
        )
    lines.append("")
    lines.append("-- 1b) identities (chỉ chèn nếu auth.users có user đó - user mới được insert thành công)")
    for u in users:
        uid = u.get("id")
        email = u.get("email")
        if not uid or not email:
            continue
        ident_data = "{\"sub\":\"" + uid + "\",\"email\":\"" + email.replace('"','') + "\"}"
        lines.append(
            "INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) "
            "SELECT "
            f"gen_random_uuid(), {sq(uid)}, {sq(uid)}, {sq(ident_data)}::jsonb, 'email', now(), now(), now() "
            f"WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = {sq(uid)}) "
            "  AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = " + sq(uid) + " AND provider = 'email');"
        )
    lines.append("")
    lines.append("-- 2) profiles (chỉ chèn nếu auth.users có user đó - tránh lỗi FK với email trùng)")
    for p in profiles:
        uid = p.get("id")
        if not uid:
            continue
        lines.append(
            "INSERT INTO public.profiles (id, username, display_name, email, role, balance, is_banned) "
            "SELECT "
            f"{sq(uid)}, {sq(p.get('username'))}, {sq(p.get('display_name'))}, {sq(p.get('email'))}, "
            f"{sq(p.get('role') or 'user')}, {snum(p.get('balance'))}, {sbool(p.get('is_banned'))} "
            f"WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = {sq(uid)}) "
            "ON CONFLICT (id) DO UPDATE SET "
            "username = EXCLUDED.username, display_name = EXCLUDED.display_name, "
            "email = EXCLUDED.email, role = EXCLUDED.role, balance = EXCLUDED.balance, "
            "is_banned = EXCLUDED.is_banned;"
        )
    lines.append("")
    lines.append("-- 3) user_games (lookup game theo appid trong DB hiện tại - vì UUID giữa 2 DB khác nhau)")
    skipped_games = 0
    for ug in user_games:
        appid = appid_by_dump_id.get(ug.get("game_id"))
        if not appid:
            skipped_games += 1
            continue
        lines.append(
            "INSERT INTO public.user_games (user_id, game_id) "
            f"SELECT {sq(ug.get('user_id'))}, g.id FROM public.games g "
            f"WHERE g.appid = {sq(appid)} "
            f"  AND EXISTS (SELECT 1 FROM public.profiles WHERE id = {sq(ug.get('user_id'))}) "
            "ON CONFLICT DO NOTHING;"
        )
    lines.append("")
    lines.append("-- 4) owned_dlcs (base_appid/dlc_appid là TEXT, không có cột purchase_price_vnd)")
    for od in owned_dlcs:
        lines.append(
            "INSERT INTO public.owned_dlcs (user_id, base_appid, dlc_appid) "
            f"SELECT {sq(od.get('user_id'))}, {sq(str(od.get('base_appid') or ''))}, "
            f"{sq(str(od.get('dlc_appid') or ''))} "
            f"WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = {sq(od.get('user_id'))}) "
            "ON CONFLICT DO NOTHING;"
        )

    lines.append("")

    with io.open(OUT_DIR + r"\import_customers.sql", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print("\nFile SQL hoàn chỉnh (giải quyết lỗi FK):")
    print(" - import_customers.sql (chạy trong Supabase SQL Editor)")
    print("   user_games bỏ qua %d dòng vì game đã bị xóa khỏi bảng games" % skipped_games)

if __name__ == "__main__":
    main()
