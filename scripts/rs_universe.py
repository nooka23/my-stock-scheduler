"""Shared helpers that keep RS rankings limited to the stock universe."""

PAGE_SIZE = 1000


def load_rs_eligible_codes(supabase) -> set[str]:
    """Load every company code explicitly marked as eligible for RS."""
    codes: set[str] = set()
    offset = 0

    while True:
        response = (
            supabase.table("companies")
            .select("code")
            .eq("is_rs_eligible", True)
            .order("code")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        rows = response.data or []
        codes.update(str(row["code"]) for row in rows if row.get("code"))

        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    if not codes:
        raise RuntimeError(
            "RS eligible universe is empty. Run update_today_v3.py after applying "
            "the companies security-type migration."
        )

    return codes
